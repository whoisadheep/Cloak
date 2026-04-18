# ResumeTerminal (Stitch Edition) 📄💼

> **The Architectural Ledger** - High-end executive resume generation from the terminal.

ResumeTerminal is a powerful CLI tool designed for professionals who demand editorial precision and ATS-optimal performance. Built with the **Stitch "Sovereign Executive"** design system, it bridges the gap between raw professional data and premium, gallery-grade PDF output.

## ✨ Features

- **Architectural Ledger Design**: Minimalist, high-contrast aesthetic using the "Sovereign Executive" palette (Deep Navy & Matte Paper).
- **ATS Optimization**: Engine-level keyword analysis and single-column layout for maximum machine readability.
- **Section Grouping**: Intelligent `KeepTogether` logic ensures headers never appear orphaned at the bottom of pages.
- **Project-Centric**: Dedicated Projects section for highlighting impact when company experience is limited.
- **Pure Python**: Zero-dependency PDF rendering via ReportLab (ATS-safe text layer).

## 🚀 Quick Start

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/YOUR_USERNAME/Cloak.git
cd Cloak
pip install -r requirements.txt
```

### 2. Initialize
Generate a sample data file and design template:

```bash
python resume_terminal.py init
```

### 3. Generate Your Resume
Edit `user_data.json` with your details, then run:

```bash
python resume_terminal.py generate --data user_data.json
```

## 🛠 Usage Guide

| Command | Description |
|---------|-------------|
| `init` | Scaffold `user_data.json` and `DESIGN.md`. |
| `design` | Export the Stitch MCP design tokens to `DESIGN.md`. |
| `generate` | Compile the PDF from your JSON data. |

### ATS Analysis
To optimize for a specific job, provide the job description:

```bash
python resume_terminal.py generate --data user_data.json --job job_description.txt
```

## 🎨 Design System: Sovereign Executive

The "Sovereign Executive" system (The Architectural Ledger) treats the page as a structured space.
- **Typography**: Inter (Stitch) / Helvetica (ATS Fallback).
- **Colors**: Ink (#1A1A2E) and Page (#F9F9F7).
- **Margins**: 0.8in architectural framing.

## 📄 License

This project is open-source and available under the MIT License.
