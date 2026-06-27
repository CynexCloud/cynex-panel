import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const TARGETS = [
  { regex: /AirLink Panel/g, replacement: 'CynexPanel' },
  { regex: /Airlink Panel/g, replacement: 'CynexPanel' },
  { regex: /AirLink/g, replacement: 'Cynex' },
  { regex: /Airlink/g, replacement: 'Cynex' },
  { regex: /AirLinkLabs/g, replacement: 'CynexCloud' },
  { regex: /airlinklabs/g, replacement: 'CynexCloud' },
  { regex: /CynexLabs\/panel/g, replacement: 'CynexCloud/panel' },
  { regex: /airlink-panel/g, replacement: 'cynex-panel' },
  { regex: /airlink/g, replacement: 'cynex' },
  { regex: /https:\/\/github\.com\/airlinklabs\/panel/g, replacement: 'https://github.com/CynexCloud/panel' }
];

function applyReplacements(text: string): string {
  let updated = text;
  for (const target of TARGETS) {
    updated = updated.replace(target.regex, target.replacement);
  }
  return updated;
}

// Recursively lists files matching criteria
function listFiles(dir: string, extensions: string[]): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.git', '.gemini', 'storage'].includes(file)) continue;
      results = results.concat(listFiles(filePath, extensions));
    } else {
      if (extensions.some(ext => file.endsWith(ext))) {
        results.push(filePath);
      }
    }
  }
  return results;
}

// Rebrand TS files safely using TypeScript AST
function rebrandTSFile(filePath: string, dryRun = false): { changes: number } {
  const content = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  interface ReplacementSpan {
    start: number;
    end: number;
    original: string;
    replaced: string;
  }

  const spans: ReplacementSpan[] = [];

  // Traverse the AST to collect only StringLiterals and Template strings
  function visit(node: ts.Node) {
    if (
      ts.isStringLiteral(node) ||
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const originalText = node.getText(sourceFile);
      const replacedText = applyReplacements(originalText);
      if (originalText !== replacedText) {
        spans.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          original: originalText,
          replaced: replacedText
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Walk comments trivia
  const comments: ReplacementSpan[] = [];
  function scanComments() {
    const text = sourceFile.text;
    let pos = 0;
    while (pos < text.length) {
      const triviaWidth = ts.getLeadingCommentRanges(text, pos);
      if (triviaWidth) {
        for (const range of triviaWidth) {
          const originalComment = text.substring(range.pos, range.end);
          const replacedComment = applyReplacements(originalComment);
          if (originalComment !== replacedComment) {
            comments.push({
              start: range.pos,
              end: range.end,
              original: originalComment,
              replaced: replacedComment
            });
          }
        }
      }
      // Simple scanner step
      const nextPos = text.indexOf('\n', pos);
      pos = nextPos === -1 ? text.length : nextPos + 1;
    }
  }
  
  scanComments();

  // Combine and sort spans in descending order of start position
  const allSpans = [...spans, ...comments].sort((a, b) => b.start - a.start);

  // De-duplicate overlapping spans
  const uniqueSpans: ReplacementSpan[] = [];
  let lastStart = Infinity;
  for (const span of allSpans) {
    if (span.end <= lastStart) {
      uniqueSpans.push(span);
      lastStart = span.start;
    }
  }

  if (uniqueSpans.length === 0) return { changes: 0 };

  // Apply changes to string
  let updatedContent = content;
  for (const span of uniqueSpans) {
    updatedContent = 
      updatedContent.substring(0, span.start) + 
      span.replaced + 
      updatedContent.substring(span.end);
  }

  if (!dryRun) {
    fs.writeFileSync(filePath, updatedContent, 'utf8');
  }

  return { changes: uniqueSpans.length };
}

// Rebrand other text files (EJS, Markdown, JSON, etc.)
function rebrandTextFile(filePath: string, dryRun = false): { changes: number } {
  const content = fs.readFileSync(filePath, 'utf8');
  const replaced = applyReplacements(content);
  
  if (content !== replaced) {
    if (!dryRun) {
      fs.writeFileSync(filePath, replaced, 'utf8');
    }
    return { changes: 1 };
  }
  return { changes: 0 };
}

function runRebrand() {
  console.log('=== Pre-Flight Analysis Pass ===');
  const tsFiles = listFiles(path.join(__dirname, '../src'), ['.ts']);
  const ejsFiles = listFiles(path.join(__dirname, '../views'), ['.ejs']);
  const mdFiles = listFiles(path.join(__dirname, '../docs'), ['.md']);
  mdFiles.push(path.join(__dirname, '../README.md'));
  
  const envExample = path.join(__dirname, '../example.env');
  const pkgJson = path.join(__dirname, '../package.json');

  let totalTSChanges = 0;
  let totalEJSChanges = 0;
  let totalDocsChanges = 0;

  // Analysis / Apply
  console.log('Scanning TypeScript files in src/...');
  for (const file of tsFiles) {
    const { changes } = rebrandTSFile(file, false);
    if (changes > 0) {
      console.log(`  [TS Rebranded] ${path.relative(path.join(__dirname, '..'), file)} - ${changes} spans modified.`);
      totalTSChanges += changes;
    }
  }

  console.log('Scanning EJS views in views/...');
  for (const file of ejsFiles) {
    const { changes } = rebrandTextFile(file, false);
    if (changes > 0) {
      console.log(`  [EJS Rebranded] ${path.relative(path.join(__dirname, '..'), file)}`);
      totalEJSChanges += changes;
    }
  }

  console.log('Scanning markdown documentation...');
  for (const file of mdFiles) {
    const { changes } = rebrandTextFile(file, false);
    if (changes > 0) {
      console.log(`  [Docs Rebranded] ${path.relative(path.join(__dirname, '..'), file)}`);
      totalDocsChanges += changes;
    }
  }

  console.log('Scanning configuration boundaries...');
  rebrandTextFile(envExample, false);
  
  // Custom package.json rebrand (limited fields)
  if (fs.existsSync(pkgJson)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    pkg.name = 'cynex-panel';
    pkg.description = 'CynexPanel, A simple-to-use game server management panel';
    pkg.author = 'CynexCloud';
    fs.writeFileSync(pkgJson, JSON.stringify(pkg, null, 2), 'utf8');
    console.log('  [package.json Rebranded] Safe metadata updated.');
  }

  console.log('\n=== Rebranding Summary ===');
  console.log(`TypeScript spans modified: ${totalTSChanges}`);
  console.log(`EJS views modified:        ${totalEJSChanges}`);
  console.log(`Documentation files modified: ${totalDocsChanges}`);
  console.log('Global rebranding completed safely.');
}

runRebrand();
