import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, of, throwError } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Auth, GoogleAuthProvider, User as FirebaseUser, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, getIdToken, confirmPasswordReset, verifyPasswordResetCode } from '@angular/fire/auth';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<AppUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private auth: Auth) {
    onAuthStateChanged(this.auth, (fbUser: FirebaseUser | null) => {
      const mapped = this.mapFirebaseUser(fbUser);
      this.currentUserSubject.next(mapped);
    });
  }

  private mapFirebaseUser(user: FirebaseUser | null): AppUser | null {
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified
    };
  }

  login(email: string, password: string): Observable<AppUser> {
    return from(signInWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap((cred) => {
        // Check if email is verified
        if (!cred.user.emailVerified) {
          // Sign out the user immediately
          return from(signOut(this.auth)).pipe(
            switchMap(() => {
              return throwError(() => new Error('Please verify your email address before logging in. Check your inbox for the verification email.'));
            })
          );
        }
        return of(this.mapFirebaseUser(cred.user) as AppUser);
      })
    );
  }

  register(email: string, password: string, displayName?: string): Observable<AppUser> {
    return from(createUserWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap(async (cred) => {
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
        await sendEmailVerification(cred.user);
        return this.mapFirebaseUser(cred.user) as AppUser;
      })
    );
  }

  loginWithGoogle(): Observable<AppUser> {
    const provider = new GoogleAuthProvider();
    return from(signInWithPopup(this.auth, provider)).pipe(
      map(cred => this.mapFirebaseUser(cred.user) as AppUser)
    );
  }

  forgotPassword(email: string): Observable<void> {
    return from(sendPasswordResetEmail(this.auth, email));
  }

  confirmPasswordReset(code: string, newPassword: string): Observable<void> {
    return from(confirmPasswordReset(this.auth, code, newPassword));
  }

  verifyPasswordResetCode(code: string): Observable<string> {
    return from(verifyPasswordResetCode(this.auth, code));
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.auth.currentUser) return null;
    return await getIdToken(this.auth.currentUser, false);
  }

  isAuthenticated(): Observable<boolean> {
    return this.currentUser$.pipe(map(user => !!user));
  }

  getCurrentUser(): AppUser | null {
    return this.currentUserSubject.value;
  }

  logout(): Observable<void> {
    return from(signOut(this.auth));
  }
}
