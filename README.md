# Canvas PDF Viewer PCF

A Power Apps Component Framework (PCF) control for viewing PDF documents in Canvas Apps.

## Features

- Multi-page PDF rendering
- Zoom in/out (Ctrl/Cmd + scroll wheel)
- Pan/drag navigation
- Responsive fit-to-width
- Clean, minimal UI with optional toolbar

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `pdfDataUri` | Text | PDF as base64 DataUri (required) |
| `showToolbar` | Boolean | Show/hide toolbar |
| `minZoom` | Decimal | Minimum zoom level (default: 0.5) |
| `maxZoom` | Decimal | Maximum zoom level (default: 3.0) |
| `zoomStep` | Decimal | Zoom increment (default: 0.1) |
| `resetToFitOnSourceChange` | Boolean | Reset view when PDF changes |
| `fitButtonText` | Text | Custom text for Fit button |
| `fitButtonWidth` | Number | Custom width for Fit button |

## Installation

1. Download the managed solution from [Releases](../../releases)
2. Import into your Power Platform environment
3. Add the component to your Canvas App

## Build from Source
```bash
npm install
npm run build
cd CanvasErgonomicPdfViewerSolution
dotnet build --configuration Release
```

## Usage
```
CanvasErgonomicPdfViewer.pdfDataUri = "data:application/pdf;base64,JVBERi0x..."
```

## License

MIT
