# Fix Azure Deployment Issues

## 🚨 Current Issues:
1. **Backend**: HTTP 401 Unauthorized error
2. **Frontend**: Red page (build/deployment issue)

## 🔧 Solutions:

### Backend Fix (HTTP 401 Error):
The backend is missing environment variables. You need to set them in Azure Portal:

1. Go to: https://portal.azure.com
2. Navigate to: **App Services** → **bidroom-backend-dev**
3. Go to **"Configuration"** → **"Application settings"**
4. Add these settings:
   - `NODE_ENV` = `development`
   - `MONGO_URI` = `mongodb+srv://josevcandido_db_user:QHVmv7msE4iNbwr9@clusterbr.pw2gswl.mongodb.net/bidroom_dev`
   - `JWT_SECRET` = `your-super-secret-jwt-key-for-development`
   - `FRONTEND_URL` = `https://bidroom-frontend-dev.azurewebsites.net`
5. Click **"Save"**
6. **Restart** the app

### Frontend Fix (Red Page):
The frontend deployment might have failed. Let's redeploy:

1. Go to: https://github.com/oficialjosecandido/BidRoom/actions
2. Check if the last deployment failed
3. If it failed, make a small change and push to trigger redeployment

## 🧪 Test After Fixes:
- Backend: https://bidroom-backend-dev.azurewebsites.net
- Frontend: https://bidroom-frontend-dev.azurewebsites.net
