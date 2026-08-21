import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const cache = new Map<string, HandlebarsTemplateDelegate>();

export class EmailTemplateEngine {
  render(templateName: string, data: Record<string, unknown>): string {
    let compiled = cache.get(templateName);
    if (!compiled) {
      const filePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);
      const source = fs.readFileSync(filePath, 'utf-8');
      compiled = Handlebars.compile(source);
      cache.set(templateName, compiled);
    }
    return compiled(data);
  }
}
