import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface SkillCronEntry {
  schedule: string;
  action: string;
  description?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  triggers?: string[];
  cron?: SkillCronEntry[];
  dirPath: string;
}

export class SkillLoader {
  private skillsDir: string;

  constructor() {
    this.skillsDir = config.paths.skillsDir;
  }

  public loadAll(): SkillMetadata[] {
    const skills: SkillMetadata[] = [];

    if (!fs.existsSync(this.skillsDir)) {
      logger.warn('SkillLoader', `Skills directory not found: ${this.skillsDir}`);
      return skills;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(this.skillsDir, entry.name, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) {
        logger.warn('SkillLoader', `Skipping directory '${entry.name}': no SKILL.md found`);
        continue;
      }

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const metadata = this.parseFrontmatter(content);

        if (!metadata || !metadata.name) {
          logger.warn('SkillLoader', `Skipping '${entry.name}': invalid frontmatter (missing name)`);
          continue;
        }

        skills.push({
          name: metadata.name,
          description: metadata.description || '',
          triggers: metadata.triggers || [],
          cron: metadata.cron || [],
          dirPath: path.join(this.skillsDir, entry.name),
        });

        logger.info('SkillLoader', `Loaded skill: ${metadata.name} (${entry.name})`);
      } catch (err) {
        logger.warn('SkillLoader', `Failed to parse skill '${entry.name}': ${err}`);
      }
    }

    logger.info('SkillLoader', `Total skills loaded: ${skills.length}`);
    return skills;
  }

  public loadSkillContent(skillPath: string): string {
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    return fs.readFileSync(skillMdPath, 'utf-8');
  }

  private parseFrontmatter(content: string): Record<string, any> | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    try {
      return yaml.load(match[1]) as Record<string, any>;
    } catch {
      return null;
    }
  }
}
