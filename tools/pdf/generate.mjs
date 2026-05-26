// Gera "Respostas-CaseCellShop.pdf" a partir de docs/RESPOSTAS.md.
// Pipeline:
//   md → HTML (marked) com Mermaid wrap → Chrome headless --print-to-pdf
// Pré-requisitos: Chrome instalado em "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RESPOSTAS = path.join(ROOT, 'docs', 'RESPOSTAS.md');
const OUT_HTML = path.join(__dirname, 'respostas.html');
const OUT_PDF = path.join(ROOT, 'Respostas-CaseCellShop.pdf');
const REPO_URL = 'https://github.com/brunohiri-oss/casecellshop-desafio-senior';

const respostasMd = await fs.readFile(RESPOSTAS, 'utf8');

// Customiza o renderer para wrap blocos ```mermaid em <div class="mermaid">
const renderer = new marked.Renderer();
const originalCode = renderer.code.bind(renderer);
renderer.code = ({ text, lang }) => {
  if (lang === 'mermaid') {
    return `<div class="mermaid">${text}</div>`;
  }
  return originalCode({ text, lang });
};
marked.use({ renderer });

const cover = `# Desafio Técnico CaseCellShop

**Nível Sênior · Backend**

**Parte 1.A — Respostas Conceituais**

**Candidato:** Bruno Hiri

**Repositório público (Parte 1.B):** <${REPO_URL}>

**Respostas online (markdown formatado):** <${REPO_URL}/blob/main/docs/RESPOSTAS.md>

<div class="pagebreak"></div>

`;

const closingEntrega = `

<hr>

## Entrega

| Artefato | Link |
|---|---|
| Repositório GitHub público | <${REPO_URL}> |
| README com instruções para rodar | <${REPO_URL}/blob/main/README.md> |
| OpenAPI (contrato) | <${REPO_URL}/blob/main/openapi.yaml> |
| PROMPTS.md (uso responsável de IA) | <${REPO_URL}/blob/main/PROMPTS.md> |
| Mini-tarefa prática (Parte 1.B) | <${REPO_URL}/tree/main/api> |
`;

const combinedMd = cover + respostasMd + closingEntrega;
const body = marked.parse(combinedMd);

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>CaseCellShop — Respostas Conceituais</title>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.55;
      color: #1f2328;
      max-width: 100%;
    }
    h1 { font-size: 22pt; border-bottom: 1px solid #d0d7de; padding-bottom: 6px; margin-top: 28px; color: #0c3a78; }
    h2 { font-size: 16pt; border-bottom: 1px solid #d0d7de; padding-bottom: 4px; margin-top: 24px; color: #0c3a78; }
    h3 { font-size: 13pt; margin-top: 18px; color: #1f2328; }
    h4 { font-size: 11.5pt; margin-top: 14px; }
    p, li { font-size: 10.5pt; }
    code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font-size: 90%; font-family: "Consolas", monospace; }
    pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 9.5pt; line-height: 1.4; page-break-inside: avoid; }
    pre code { background: transparent; padding: 0; font-size: 100%; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
    th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; font-size: 10pt; vertical-align: top; }
    th { background: #f6f8fa; font-weight: 600; }
    blockquote { border-left: 4px solid #d0d7de; padding-left: 12px; color: #57606a; margin-left: 0; font-style: italic; }
    a { color: #0969da; text-decoration: none; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 24px 0; }
    .pagebreak { page-break-after: always; }
    .mermaid { text-align: center; margin: 16px 0; page-break-inside: avoid; }
    ul, ol { padding-left: 24px; }
    li { margin: 3px 0; }
  </style>
</head>
<body>
  ${body}

  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose', flowchart: { useMaxWidth: true } });
    // Marca quando todos os diagramas terminaram de renderizar
    window.mermaidReady = false;
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await mermaid.run();
      } finally {
        window.mermaidReady = true;
        document.title += ' (READY)';
      }
    });
  </script>
</body>
</html>`;

await fs.writeFile(OUT_HTML, html, 'utf8');
console.log('[1/2] HTML gerado:', OUT_HTML);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fileUrl = 'file:///' + OUT_HTML.replace(/\\/g, '/');

execFileSync(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-pdf-header-footer',
  '--virtual-time-budget=20000',
  '--run-all-compositor-stages-before-draw',
  `--print-to-pdf=${OUT_PDF}`,
  fileUrl,
], { stdio: 'inherit' });

const stat = await fs.stat(OUT_PDF);
console.log(`[2/2] PDF gerado: ${OUT_PDF} (${Math.round(stat.size / 1024)} KB)`);
