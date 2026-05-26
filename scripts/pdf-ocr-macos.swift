#!/usr/bin/env swift
import AppKit
import Foundation
import PDFKit
import Vision

func usage() -> Never {
  fputs("Usage: pdf-ocr-macos.swift <pdf-path> [--max-pages N]\n", stderr)
  exit(2)
}

let args = CommandLine.arguments.dropFirst()
guard let pdfPath = args.first else {
  usage()
}

var maxPages: Int?
var fromPage = 1
if let maxIndex = args.firstIndex(of: "--max-pages") {
  let valueIndex = args.index(after: maxIndex)
  guard valueIndex < args.endIndex, let parsed = Int(args[valueIndex]) else {
    usage()
  }
  maxPages = parsed
}
if let fromIndex = args.firstIndex(of: "--from-page") {
  let valueIndex = args.index(after: fromIndex)
  guard valueIndex < args.endIndex, let parsed = Int(args[valueIndex]), parsed > 0 else {
    usage()
  }
  fromPage = parsed
}

guard let document = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
  fputs("Unable to open PDF: \(pdfPath)\n", stderr)
  exit(1)
}

let startIndex = min(max(fromPage - 1, 0), document.pageCount)
let endIndex = min(document.pageCount, startIndex + (maxPages ?? document.pageCount))
for index in startIndex..<endIndex {
  guard let page = document.page(at: index) else {
    continue
  }

  let bounds = page.bounds(for: .mediaBox)
  let scale: CGFloat = 2.0
  let imageSize = NSSize(width: bounds.width * scale, height: bounds.height * scale)
  let image = NSImage(size: imageSize)

  image.lockFocus()
  NSColor.white.setFill()
  NSRect(origin: .zero, size: imageSize).fill()
  guard let context = NSGraphicsContext.current?.cgContext else {
    image.unlockFocus()
    continue
  }
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  image.unlockFocus()

  guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    continue
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  do {
    try handler.perform([request])
  } catch {
    fputs("OCR failed on page \(index + 1): \(error)\n", stderr)
    continue
  }

  let lines = (request.results ?? []).compactMap { observation in
    observation.topCandidates(1).first?.string
  }
  if !lines.isEmpty {
    print("Page \(index + 1) of \(document.pageCount)")
    print(lines.joined(separator: "\n"))
  }
}
