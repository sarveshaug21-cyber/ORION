/**
 * ORION Skill Registry
 * Manages skill loading, registration, and discovery
 */

import type {
  Skill,
  SkillRegistry,
  SkillManifest,
  SkillCommand,
  SkillCommandContext,
  SkillCommandResult,
} from '@/types/index.js';
import { stmt } from '@/database/client.js';
import { createOrionError } from '@/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';

export class SkillRegistryImpl implements SkillRegistry {
  private skills = new Map<string, Skill>();
  private commandMap = new Map<string, { skill: Skill; command: SkillCommand }>();

  async register(skill: Skill): Promise<void> {
    const name = skill.manifest.metadata.name;

    if (this.skills.has(name)) {
      throw createOrionError(
        'SKILL_ALREADY_REGISTERED',
        `Skill "${name}" already registered`,
        `Skill "${name}" is already loaded`,
        { recoverable: false }
      );
    }

    // Initialize skill with its config
    await skill.initialize(skill.getConfig());

    // Register tools (handled by the skill itself during initialization)
    // for (const [_toolName, _tool] of skill.tools) {
    //   // Tool registration is handled by the skill itself
    // }

    // Register commands
    for (const [cmdName, cmd] of skill.commands) {
      const fullName = `${name}.${cmdName}`;
      if (this.commandMap.has(fullName)) {
        throw createOrionError(
          'COMMAND_CONFLICT',
          `Command "${fullName}" conflicts with existing command`,
          `Command name conflict: ${fullName}`,
          { recoverable: false }
        );
      }
      this.commandMap.set(fullName, { skill, command: cmd });
    }

    this.skills.set(name, skill);

    // Persist to database
    await this.persistSkill(skill);
  }

  async unregister(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw createOrionError(
        'SKILL_NOT_FOUND',
        `Skill "${name}" not found`,
        `Skill "${name}" is not loaded`,
        { recoverable: false }
      );
    }

    // Unregister commands
    for (const cmdName of skill.commands.keys()) {
      this.commandMap.delete(`${name}.${cmdName}`);
    }

    // Shutdown skill
    await skill.shutdown();

    this.skills.delete(name);

    // Update database
    stmt.disableSkill.run(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  getByKeyword(keyword: string): Skill[] {
    const lower = keyword.toLowerCase();
    return Array.from(this.skills.values()).filter((skill) =>
      skill.manifest.metadata.keywords.some((k) => k.toLowerCase().includes(lower))
    );
  }

  async loadFromDirectory(path: string): Promise<void> {
    const skillDirs = await fs.readdir(path, { withFileTypes: true });

    for (const dir of skillDirs) {
      if (!dir.isDirectory()) continue;

      const skillPath = join(path, dir.name);
      const manifestPath = join(skillPath, 'manifest.json');

      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest: SkillManifest = JSON.parse(manifestContent);

        // Check if skill is enabled in database
        const dbSkill = stmt.getSkill.get(manifest.metadata.name) as any;
        if (dbSkill && !dbSkill.enabled) continue;

        // Load the skill module
        const skillModule = await import(join(skillPath, 'index.js'));
        const skillClass = skillModule.default || skillModule[manifest.metadata.name];

        if (!skillClass) {
          console.warn(`Skill ${manifest.metadata.name} has no default export`);
          continue;
        }

        const skill = new skillClass() as Skill;
        
        // Apply saved config
        if (dbSkill?.config) {
          await skill.updateConfig(JSON.parse(dbSkill.config));
        }

        await this.register(skill);
      } catch (error) {
        console.warn(`Failed to load skill from ${skillPath}:`, error);
      }
    }
  }

  getCommand(fullName: string): { skill: Skill; command: SkillCommand } | undefined {
    return this.commandMap.get(fullName);
  }

  listCommands(): Array<{ name: string; description: string; usage: string }> {
    const commands: Array<{ name: string; description: string; usage: string }> = [];
    for (const [name, { command }] of this.commandMap) {
      commands.push({ name, description: command.description, usage: command.usage });
    }
    return commands;
  }

  async executeCommand(fullName: string, args: string[], context: SkillCommandContext): Promise<SkillCommandResult> {
    const entry = this.commandMap.get(fullName);
    if (!entry) {
      return { success: false, error: `Command "${fullName}" not found` };
    }

    try {
      return await entry.command.execute(args, context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Command execution failed',
      };
    }
  }

  private async persistSkill(skill: Skill): Promise<void> {
    const manifest = skill.manifest;
    const config = skill.getConfig();

    stmt.upsertSkill.run(
      manifest.metadata.name,
      manifest.metadata.version,
      manifest.metadata.description,
      manifest.metadata.author || null,
      manifest.metadata.license || null,
      manifest.metadata.homepage || null,
      manifest.metadata.repository || null,
      JSON.stringify(manifest.metadata.keywords),
      manifest.metadata.minOrionVersion || null,
      JSON.stringify(manifest.metadata.dependencies || []),
      manifest.configSchema ? JSON.stringify(manifest.configSchema) : null,
      JSON.stringify(manifest.defaultConfig || {}),
      JSON.stringify(config),
      1, // enabled
      Date.now(),
      Date.now()
    );
  }
}

export const skillRegistry = new SkillRegistryImpl();

// Base skill class for extension
export abstract class BaseSkill implements Skill {
  abstract readonly manifest: SkillManifest;
  abstract readonly tools: Map<string, any>;
  abstract readonly commands: Map<string, SkillCommand>;

  protected config: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = { ...this.manifest.defaultConfig, ...config };
    await this.onInitialize();
  }

  protected async onInitialize(): Promise<void> {
    // Override in subclass
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
  }

  protected async onShutdown(): Promise<void> {
    // Override in subclass
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  async updateConfig(config: Record<string, unknown>): Promise<void> {
    this.config = { ...this.config, ...config };
    await this.onConfigUpdate(this.config);
    
    // Persist to database
    stmt.upsertSkill.run(
      this.manifest.metadata.name,
      this.manifest.metadata.version,
      this.manifest.metadata.description,
      this.manifest.metadata.author || null,
      this.manifest.metadata.license || null,
      this.manifest.metadata.homepage || null,
      this.manifest.metadata.repository || null,
      JSON.stringify(this.manifest.metadata.keywords),
      this.manifest.metadata.minOrionVersion || null,
      JSON.stringify(this.manifest.metadata.dependencies || []),
      this.manifest.configSchema ? JSON.stringify(this.manifest.configSchema) : null,
      JSON.stringify(this.manifest.defaultConfig || {}),
      JSON.stringify(this.config),
      1,
      Date.now(),
      Date.now()
    );
  }

  protected async onConfigUpdate(_config: Record<string, unknown>): Promise<void> {
    // Override in subclass
  }
}

// Helper to create skill commands
export function createSkillCommand(
  name: string,
  description: string,
  usage: string,
  execute: (args: string[], context: SkillCommandContext) => Promise<SkillCommandResult>
): SkillCommand {
  return { name, description, usage, execute };
}