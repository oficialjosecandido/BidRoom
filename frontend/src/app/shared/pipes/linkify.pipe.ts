import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { linkifyText } from '../utils/linkify.util';

@Pipe({ name: 'linkify', standalone: true, pure: true })
export class LinkifyPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(linkifyText(value ?? ''));
  }
}
