/**
 * ORION Skills Module
 * Exports all skill-related functionality
 */

export * from './registry.js';
export * from './builtin.js';

import { skillRegistry } from './registry.js';
import { builtinSkills } from './builtin.js';

export async function loadBuiltinSkills(): Promise<void> {
  for (const SkillClass of builtinSkills) {
    const skill = new SkillClass();
    await skillRegistry.register(skill);
  }
}

export { skillRegistry };