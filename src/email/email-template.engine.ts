import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const cache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Renders a named body template inside `base.hbs` (GitHub/Cursor-style layout:
 * logo + wordmark, Exo type, no card chrome).
 */
export class EmailTemplateEngine {
  render(templateName: string, data: Record<string, unknown>): string {
    if (templateName === 'base') {
      return this.compile('base')(data);
    }

    const body = this.compile(templateName)(data);
    return this.compile('base')({
      ...data,
      body,
      title: (data.title as string) ?? 'SANTRACK',
    });
  }

  private compile(templateName: string): HandlebarsTemplateDelegate {
    let compiled = cache.get(templateName);
    if (!compiled) {
      const filePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);
      const source = fs.readFileSync(filePath, 'utf-8');
      compiled = Handlebars.compile(source);
      cache.set(templateName, compiled);
    }
    return compiled;
  }
}
