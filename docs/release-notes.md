## Opening the app the first time

Shortcut for Orca is unsigned, so macOS blocks it on first launch.

1. Drag **Shortcut for Orca** to Applications. You may need temporary admin access to copy it there.
2. Try to open it once. macOS will say it can't verify the app.
3. Open System Settings → Privacy & Security, scroll down and click **Open Anyway** next to Shortcut for Orca.

Or, in a terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/Shortcut for Orca.app"
```

Then follow the **Setup** tab in the app. Use `arm64` for Apple Silicon and `x64` for Intel Macs.
