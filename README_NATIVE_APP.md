# Novara Cleaner - Native Mobile App Setup

This guide will help you build and deploy the native mobile app for iOS and Android app stores.

## Prerequisites

### For iOS Development
- **Mac computer** running macOS (required for iOS builds)
- **Xcode 14 or later** (download from Mac App Store)
- **Apple Developer Account** ($99/year) - [Sign up here](https://developer.apple.com)
- **CocoaPods** - Install via: `sudo gem install cocoapods`

### For Android Development
- **Android Studio** (latest version) - [Download here](https://developer.android.com/studio)
- **Google Play Developer Account** ($25 one-time fee) - [Sign up here](https://play.google.com/console)
- **Java Development Kit (JDK) 11 or later**

### General Requirements
- **Git** installed on your machine
- **Node.js 18+** and **npm** or **Bun**
- Basic command line knowledge

---

## Step 1: Export and Clone the Project

1. **Export to GitHub:**
   - Click the GitHub button in the top right of Lovable
   - Connect your GitHub account if not already connected
   - Export the project to a new repository

2. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

3. **Install dependencies:**
   ```bash
   npm install
   # or
   bun install
   ```

---

## Step 2: Build the Web App

Before adding native platforms, build the web app:

```bash
npm run build
# or
bun run build
```

This creates the `dist` folder that Capacitor will use.

---

## Step 3: Add Native Platforms

### Add iOS Platform (Mac only)

```bash
npx cap add ios
```

This creates an `ios` folder with an Xcode project.

### Add Android Platform

```bash
npx cap add android
```

This creates an `android` folder with an Android Studio project.

---

## Step 4: Sync Assets and Configuration

After adding platforms, sync the web assets:

```bash
npx cap sync
```

Run this command **every time** you:
- Make changes to the web app
- Update Capacitor plugins
- Modify `capacitor.config.ts`

---

## Step 5: iOS App Development & Deployment

### Open Project in Xcode

```bash
npx cap open ios
```

### Configure iOS Project

1. **Select the project** in the left sidebar
2. **Under "Signing & Capabilities":**
   - Select your **Team** (Apple Developer Account)
   - Ensure **Automatically manage signing** is checked
   - Update **Bundle Identifier** to match your app ID (e.g., `app.lovable.novaracleaning.cleaner`)

3. **Update Display Name:**
   - In the "General" tab, set **Display Name** to "Novara Cleaner"

4. **Configure Icons and Splash Screen:**
   - Add app icons in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
   - Use 1024x1024px icon (Xcode will generate other sizes)
   - For splash screen, add launch images in `Assets.xcassets`

### Add Required Permissions

Open `ios/App/App/Info.plist` and add:

```xml
<key>NSCameraUsageDescription</key>
<string>We need camera access to take before/after photos of cleaning jobs</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>We need photo library access to save job photos</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to verify job check-ins</string>
```

### Test on iOS Simulator

1. Select a simulator device (e.g., iPhone 14 Pro)
2. Click the **Play** button in Xcode
3. Test all features: camera, location, push notifications

### Build for TestFlight

1. In Xcode, select **Product > Archive**
2. Once archived, click **Distribute App**
3. Select **App Store Connect**
4. Follow prompts to upload to TestFlight
5. In [App Store Connect](https://appstoreconnect.apple.com):
   - Add test users
   - Submit for review
   - Once approved, invite testers

### Submit to App Store

1. In App Store Connect, create a new app listing
2. Fill in metadata: name, description, screenshots, keywords
3. Upload screenshots (use Xcode simulator + screenshots)
4. Set pricing and availability
5. Submit for review (typically 1-3 days)

---

## Step 6: Android App Development & Deployment

### Open Project in Android Studio

```bash
npx cap open android
```

### Configure Android Project

1. **Update package name:**
   - In `android/app/build.gradle`, verify `applicationId` matches your app ID

2. **Update app name:**
   - In `android/app/src/main/res/values/strings.xml`:
   ```xml
   <string name="app_name">Novara Cleaner</string>
   ```

3. **Add app icons:**
   - Replace icons in `android/app/src/main/res/mipmap-*` folders
   - Use [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/) to generate icons

4. **Configure splash screen:**
   - Update `android/app/src/main/res/drawable/splash.png`

### Add Required Permissions

Open `android/app/src/main/AndroidManifest.xml` and verify these permissions exist:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.VIBRATE" />
```

### Test on Android Emulator

1. Create an emulator in Android Studio (AVD Manager)
2. Click **Run** (green play button)
3. Test all features

### Build Release APK/AAB

1. **Generate a signing key:**
   ```bash
   keytool -genkey -v -keystore my-release-key.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
   ```

2. **Configure signing** in `android/app/build.gradle`:
   ```gradle
   android {
       ...
       signingConfigs {
           release {
               storeFile file("my-release-key.keystore")
               storePassword "your-password"
               keyAlias "my-key-alias"
               keyPassword "your-password"
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
               ...
           }
       }
   }
   ```

3. **Build the release bundle:**
   ```bash
   cd android
   ./gradlew bundleRelease
   ```

4. **Find the AAB:**
   - Located at `android/app/build/outputs/bundle/release/app-release.aab`

### Submit to Google Play

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app
3. Fill in store listing: description, screenshots, graphics
4. Upload the AAB file
5. Complete content rating questionnaire
6. Set pricing and distribution
7. Submit for review (typically approved within hours)

---

## Step 7: Configure Push Notifications

### iOS (APNs)

1. In [Apple Developer Portal](https://developer.apple.com):
   - Go to **Certificates, Identifiers & Profiles**
   - Create an **APNs Key** for push notifications
   - Download the `.p8` key file

2. Configure in your backend (Supabase Edge Functions or notification service)

### Android (FCM)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project or use existing
3. Add Android app with your package name
4. Download `google-services.json`
5. Place it in `android/app/`
6. In `android/build.gradle`, add:
   ```gradle
   classpath 'com.google.gms:google-services:4.3.15'
   ```
7. In `android/app/build.gradle`, add:
   ```gradle
   apply plugin: 'com.google.gms.google-services'
   ```

---

## Step 8: Testing Checklist

Before submitting to stores, test:

- [ ] Authentication (sign in/sign out)
- [ ] Dashboard loads correctly
- [ ] Job offers display and refresh
- [ ] Accept/Decline job offers
- [ ] Camera functionality (before/after photos)
- [ ] GPS check-in/check-out
- [ ] Push notifications (test via Firebase/APNs)
- [ ] Haptic feedback on interactions
- [ ] Pull-to-refresh functionality
- [ ] Offline mode (airplane mode test)
- [ ] Profile updates
- [ ] Earnings display
- [ ] Navigation between all screens
- [ ] Back button behavior
- [ ] Orientation changes
- [ ] Different screen sizes (iPhone SE, iPhone 14 Pro Max, various Android devices)

---

## Step 9: App Store Listing Requirements

### Screenshots Required

**iOS:**
- 6.7" display (iPhone 14 Pro Max): 1290 x 2796px
- 5.5" display (iPhone 8 Plus): 1242 x 2208px

**Android:**
- Minimum 2 screenshots, maximum 8
- Recommended: 1080 x 1920px (portrait)

### App Description Template

```
Novara Cleaner - Your Professional Cleaning Job Management App

Manage your cleaning jobs on the go with the Novara Cleaner mobile app. 

KEY FEATURES:
• Real-time job offers with instant notifications
• Accept or decline jobs with one tap
• GPS-verified check-in and check-out
• Before and after photo documentation
• Track your earnings and payouts
• Manage your availability and schedule
• View job history and customer ratings

BUILT FOR CLEANERS:
The Novara Cleaner app puts everything you need in your pocket. Get notified instantly when new jobs are available, navigate to job sites, document your work with photos, and track your income - all from your mobile device.

SUPPORT:
Need help? Contact us at support@novaracleaning.com
```

---

## Step 10: Ongoing Updates

### Making Changes

1. **Update the web app** in Lovable
2. **Export to GitHub** (or git pull changes)
3. **Rebuild:**
   ```bash
   npm run build
   npx cap sync
   ```
4. **Test in Xcode/Android Studio**
5. **Archive and submit** new version to stores

### Version Bumping

Update version numbers in:
- `package.json` - `"version": "1.0.1"`
- `capacitor.config.ts` - add `version: "1.0.1"`
- iOS: Xcode project settings > General > Version
- Android: `android/app/build.gradle` > `versionCode` and `versionName`

---

## Troubleshooting

### Common Issues

**"Command not found: cap"**
- Run: `npm install -g @capacitor/cli`

**iOS Build Fails**
- Clean build folder: Xcode > Product > Clean Build Folder
- Delete `ios/App/Pods` and run `npx cap sync ios`

**Android Build Fails**
- Invalidate caches: Android Studio > File > Invalidate Caches / Restart
- Run: `cd android && ./gradlew clean`

**Hot Reload Not Working**
- Verify `server.url` in `capacitor.config.ts` matches your sandbox URL
- Check device and computer are on same network
- Restart the app

---

## Additional Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [iOS App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policies](https://play.google.com/about/developer-content-policy/)
- [Capacitor Community Plugins](https://github.com/capacitor-community)

---

## Support

For questions or issues with the native app setup:
- Check the [Lovable Discord](https://discord.com/channels/1119885301872070706/1280461670979993613)
- Review [Capacitor docs](https://capacitorjs.com/docs)
- Contact Novara support: support@novaracleaning.com

---

**Ready to build your native app!** Follow these steps carefully, and you'll have a production-ready mobile app in the App Store and Google Play Store.
