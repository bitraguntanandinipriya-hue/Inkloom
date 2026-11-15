import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';
import { db } from './db';

interface ExportOptions {
  userId: string;
  novelId: string;
  includeStoryBible?: boolean;
}

function loadExportData({ userId, novelId }: ExportOptions) {
  const novel = db
    .prepare('SELECT * FROM novels WHERE id = ? AND user_id = ?')
    .get(novelId, userId) as
    | {
        id: string;
        title: string;
        author_name: string;
        genre: string;
        synopsis: string;
      }
    | undefined;
  if (!novel) {
    throw new Error('Novel not found.');
  }

  const chapters = db
    .prepare(
      `SELECT chapter_number, title, content, word_count
       FROM chapters
       WHERE novel_id = ? AND user_id = ? AND trashed_at IS NULL
       ORDER BY chapter_number ASC`
    )
    .all(novelId, userId) as Array<{
    chapter_number: number;
    title: string;
    content: string;
    word_count: number;
  }>;

  const characters = db
    .prepare('SELECT name, role, archetype, status, backstory FROM characters WHERE novel_id = ? AND user_id = ?')
    .all(novelId, userId) as Array<{
    name: string;
    role: string;
    archetype: string;
    status: string;
    backstory: string;
  }>;

  const canon = db
    .prepare(
      `SELECT category, fact_text FROM canon_facts
       WHERE novel_id = ? AND user_id = ? AND is_pinned = 1`
    )
    .all(novelId, userId) as Array<{ category: string; fact_text: string }>;

  return { novel, chapters, characters, canon };
}

export function generateTxtExport(opts: ExportOptions): { filename: string; content: string } {
  const { novel, chapters, characters, canon } = loadExportData(opts);
  const lines: string[] = [];

  lines.push(novel.title.toUpperCase());
  if (novel.author_name?.trim()) {
    lines.push(`by ${novel.author_name.trim()}`);
  }
  lines.push('');
  lines.push('='.repeat(48));
  lines.push('');

  for (const ch of chapters) {
    lines.push(`Chapter ${ch.chapter_number}: ${ch.title}`);
    lines.push('-'.repeat(36));
    lines.push('');
    lines.push(ch.content.trim());
    lines.push('');
    lines.push('');
  }

  if (opts.includeStoryBible) {
    lines.push('='.repeat(48));
    lines.push('APPENDIX: STORY BIBLE & CANON');
    lines.push('');
    for (const c of characters) {
      lines.push(`* ${c.name} (${c.role || c.archetype || 'Character'} — ${c.status})`);
      if (c.backstory) lines.push(`  ${c.backstory}`);
    }
    lines.push('');
    for (const f of canon) {
      lines.push(`- [${f.category}] ${f.fact_text}`);
    }
  }

  const safeName = novel.title.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'novel';
  return {
    filename: `${safeName}.txt`,
    content: lines.join('\n'),
  };
}

export async function generateDocxExport(opts: ExportOptions): Promise<{
  filename: string;
  buffer: Buffer;
}> {
  const { novel, chapters, characters, canon } = loadExportData(opts);

  const children: Paragraph[] = [];

  // Title Page
  children.push(
    new Paragraph({
      spacing: { before: 2800, after: 400 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: novel.title,
          font: 'Georgia',
          size: 56,
          bold: true,
        }),
      ],
    })
  );

  if (novel.author_name?.trim()) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 240 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `by ${novel.author_name.trim()}`,
            font: 'Georgia',
            size: 28,
            italics: true,
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 600 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: novel.genre,
          font: 'Georgia',
          size: 22,
          color: '666666',
        }),
      ],
    })
  );

  // Chapters (each starting on a new page)
  for (const ch of chapters) {
    children.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 480 },
        children: [
          new TextRun({
            text: `Chapter ${ch.chapter_number}: ${ch.title}`,
            font: 'Georgia',
            size: 32,
            bold: true,
          }),
        ],
      })
    );

    const paragraphs = ch.content
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      children.push(
        new Paragraph({
          spacing: { line: 360, after: 200 },
          children: [
            new TextRun({
              text: '',
              font: 'Georgia',
              size: 24,
            }),
          ],
        })
      );
    } else {
      for (const para of paragraphs) {
        children.push(
          new Paragraph({
            spacing: { line: 360, after: 220 },
            indent: { firstLine: 360 },
            children: [
              new TextRun({
                text: para,
                font: 'Georgia',
                size: 24,
              }),
            ],
          })
        );
      }
    }
  }

  // Optional Story Bible appendix ONLY if explicitly requested
  if (opts.includeStoryBible) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 320 },
        children: [
          new TextRun({
            text: 'Appendix: Story Bible & Canon',
            font: 'Georgia',
            size: 30,
            bold: true,
          }),
        ],
      })
    );

    for (const c of characters) {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new TextRun({ text: `${c.name} `, font: 'Georgia', size: 22, bold: true }),
            new TextRun({
              text: `(${c.role || c.archetype || 'Character'} · ${c.status})`,
              font: 'Georgia',
              size: 22,
              italics: true,
            }),
          ],
        })
      );
      if (c.backstory) {
        children.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: c.backstory, font: 'Georgia', size: 22 })],
          })
        );
      }
    }

    for (const f of canon) {
      children.push(
        new Paragraph({
          spacing: { after: 140 },
          children: [
            new TextRun({ text: `[${f.category}] `, font: 'Georgia', size: 22, bold: true }),
            new TextRun({ text: f.fact_text, font: 'Georgia', size: 22 }),
          ],
        })
      );
    }
  }

  const doc = new Document({
    creator: novel.author_name || 'Inkloom Author',
    title: novel.title,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = novel.title.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'novel';
  return {
    filename: `${safeName}.docx`,
    buffer,
  };
}
