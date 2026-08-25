# Icons — AutoReel

## Fișiere

| Fișier | Folosit la |
|---|---|
| `logo.svg` | Logo complet (gradient portocaliu + AR alb). Folosit în-app prin widget-ul `AutoReelLogo`. |
| `logo_monochrome.svg` | Doar literele AR cu `currentColor`. Util pentru iconițe inline, dark/light mode adaptive. |
| `logo_icon.png` *(de generat)* | Versiune PNG 1024×1024 pentru launcher icons. |
| `logo_foreground.png` *(de generat)* | Adaptive icon foreground Android — literele AR transparent, fără gradient. |

## Cum generezi launcher icons (Android + iOS + Web + Windows)

### Pasul 1 — Exportă PNG-urile din SVG

Ai 2 opțiuni:

**Opțiunea A — online (rapid)**
1. Deschide https://svgtopng.com sau https://cloudconvert.com/svg-to-png
2. Încarcă `logo.svg` → setează dimensiune **1024×1024** → descarcă → salvează ca `logo_icon.png` în acest folder
3. Pentru adaptive foreground:
   - Deschide `logo_monochrome.svg` (literele albe pe transparent — schimbă `currentColor` cu `#FFFFFF` în fișier)
   - Convertește la PNG 1024×1024 cu fundal transparent → salvează ca `logo_foreground.png`

**Opțiunea B — local cu ImageMagick / Inkscape**
```bash
# Folosind Inkscape (preferat)
inkscape assets/icons/logo.svg --export-type=png --export-width=1024 --export-filename=assets/icons/logo_icon.png

# Sau folosind ImageMagick
magick -density 384 assets/icons/logo.svg -resize 1024x1024 assets/icons/logo_icon.png
```

### Pasul 2 — Generează icoanele

```bash
cd C:\Users\user\Projects\AutoReel
flutter pub get
dart run flutter_launcher_icons
```

Asta va popula automat:
- `android/app/src/main/res/mipmap-*/ic_launcher.png` (toate densitățile)
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` (adaptive)
- `ios/Runner/Assets.xcassets/AppIcon.appiconset/*`
- `web/icons/Icon-*.png` + favicon
- `windows/runner/resources/app_icon.ico`

### Pasul 3 — Rebuild

```bash
flutter run
```

La primul cold start cu rebuild complet o să vezi noul icon pe ecranul principal.

## Configul de la flutter_launcher_icons

Vezi blocul `flutter_launcher_icons:` din `pubspec.yaml`. Acolo poți ajusta:
- Culoarea de fundal pentru iOS / Android adaptive
- Inset-ul pentru adaptive foreground (cât de mult „respiră" în interiorul cercului/pătratului mascat)
- Dacă vrei dezactivat pentru o platformă, schimbă `true` → `false`

## Logo de marketing / store

Pentru store listings (Play Store icon 512×512, App Store icon 1024×1024, og:image pentru share-uri), folosește același `logo.svg` exportat la dimensiunile cerute. Pentru un og:image landscape 1200×630, plasează logo-ul pe un fundal portocaliu cu tagline-ul „Nu mai cauți mașini. Le descoperi." dedesubt.
