/**
 * ORION Tool Registry
 * Manages tool registration, validation, and execution
 */

import type {
  ToolDefinition,
  ToolRegistry,
  ToolSchema,
  ToolExecutionContext,
  ToolResult,
  ToolCall,
  PermissionLevel,
  OrionError,
} from '../types/index.js';
import { createEventEmitter, type EventEmitter } from '../lib/utils.js';
import { createOrionError } from '../types/index.js';
import { z } from 'zod';

type ToolRegistryEvents = {
  'tool:registered': ToolDefinition;
  'tool:unregistered': string;
  'tool:executed': { toolCall: ToolCall; result: ToolResult };
  'tool:failed': { toolCall: ToolCall; error: OrionError };
};

export class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private events: EventEmitter<ToolRegistryEvents> = createEventEmitter<ToolRegistryEvents>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw createOrionError(
        'TOOL_ALREADY_EXISTS',
        `Tool "${tool.name}" already registered`,
        `Tool "${tool.name}" is already registered`,
        { recoverable: false }
      );
    }

    this.validateToolDefinition(tool);
    this.tools.set(tool.name, tool);
    this.events.emit('tool:registered', tool);
  }

  unregister(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) {
      throw createOrionError(
        'TOOL_NOT_FOUND',
        `Tool "${name}" not found`,
        `Tool "${name}" is not registered`,
        { recoverable: false }
      );
    }
    this.tools.delete(name);
    this.events.emit('tool:unregistered', name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByPermissionLevel(level: PermissionLevel): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.permissionLevel === level);
  }

  getSchema(name: string): ToolSchema | undefined {
    return this.tools.get(name)?.schema;
  }

  validateArguments(name: string, args: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(name);
    if (!tool) {
      return { valid: false, errors: [`Tool "${name}" not found`] };
    }

    try {
      this.validateAgainstSchema(tool.schema, args);
      return { valid: true, errors: [] };
    } catch (error) {
      return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    toolCallId?: string
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`,
      };
    }

    const validation = this.validateArguments(name, args);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid arguments: ${validation.errors.join(', ')}`,
      };
    }

    const toolCall: ToolCall = {
      id: toolCallId || `tc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      toolName: name,
      arguments: args,
      status: 'executing',
      startedAt: new Date(),
    };

    try {
      const result = await tool.execute(args, context);
      toolCall.status = result.success ? 'completed' : 'failed';
      toolCall.result = result;
      toolCall.completedAt = new Date();

      this.events.emit('tool:executed', { toolCall, result });
      return result;
    } catch (error) {
      const orionError = error instanceof Error ? error : new Error(String(error));
      toolCall.status = 'failed';
      toolCall.result = { success: false, error: orionError.message };
      toolCall.completedAt = new Date();

      this.events.emit('tool:failed', { toolCall, error: orionError as OrionError });
      return { success: false, error: orionError.message };
    }
  }

  on<K extends keyof ToolRegistryEvents>(event: K, listener: (data: ToolRegistryEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  private validateToolDefinition(tool: ToolDefinition): void {
    if (!tool.name || !tool.name.match(/^[a-z][a-z0-9_.-]*$/)) {
      throw createOrionError(
        'INVALID_TOOL_NAME',
        'Tool name must be lowercase with dots, underscores, or hyphens',
        'Invalid tool name format',
        { recoverable: false }
      );
    }

    if (!tool.description || tool.description.length < 10) {
      throw createOrionError(
        'INVALID_TOOL_DESCRIPTION',
        'Tool description must be at least 10 characters',
        'Tool description too short',
        { recoverable: false }
      );
    }

    if (!tool.schema || tool.schema.type !== 'object') {
      throw createOrionError(
        'INVALID_TOOL_SCHEMA',
        'Tool schema must be an object type',
        'Invalid tool schema',
        { recoverable: false }
      );
    }

    if (!['READ_ONLY', 'SAFE_ACTION', 'REQUIRES_CONFIRMATION'].includes(tool.permissionLevel)) {
      throw createOrionError(
        'INVALID_PERMISSION_LEVEL',
        'Permission level must be READ_ONLY, SAFE_ACTION, or REQUIRES_CONFIRMATION',
        'Invalid permission level',
        { recoverable: false }
      );
    }

    if (typeof tool.execute !== 'function') {
      throw createOrionError(
        'MISSING_EXECUTE_FUNCTION',
        'Tool must have an execute function',
        'Tool execute function missing',
        { recoverable: false }
      );
    }
  }

  private validateAgainstSchema(schema: ToolSchema, data: Record<string, unknown>): void {
    // Use Zod for validation
    const zodSchema = this.schemaToZod(schema);
    zodSchema.parse(data);
  }

  private schemaToZod(schema: ToolSchema): z.ZodTypeAny {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(schema.properties || {})) {
      shape[key] = this.propertyToZod(prop);
    }

    let zodObject: z.ZodTypeAny = z.object(shape);

    if (schema.required && schema.required.length > 0) {
      const requiredShape: Record<string, true> = {};
      for (const key of schema.required) {
        requiredShape[key] = true;
      }
      zodObject = (zodObject as any).required(requiredShape);
    }

    if (!schema.additionalProperties) {
      zodObject = (zodObject as any).strict();
    }

    return zodObject;
  }

  private propertyToZod(prop: any): z.ZodTypeAny {
    switch (prop.type) {
      case 'string': {
        let strSchema: z.ZodTypeAny = z.string();
        if (prop.enum) strSchema = z.enum(prop.enum as [string, ...string[]]);
        if (prop.description) strSchema = strSchema.describe(prop.description);
        return prop.required ? strSchema : strSchema.optional();
      }

      case 'number': {
        let numSchema: z.ZodTypeAny = z.number();
        if (prop.description) numSchema = numSchema.describe(prop.description);
        return prop.required ? numSchema : numSchema.optional();
      }

      case 'boolean': {
        let boolSchema: z.ZodTypeAny = z.boolean();
        if (prop.description) boolSchema = boolSchema.describe(prop.description);
        return prop.required ? boolSchema : boolSchema.optional();
      }

      case 'array':
        if (!prop.items) return z.array(z.unknown());
        return z.array(this.propertyToZod(prop.items));

      case 'object': {
        if (!prop.properties) return z.record(z.unknown());
        const objShape: Record<string, z.ZodTypeAny> = {};
        for (const [k, v] of Object.entries(prop.properties)) {
          objShape[k] = this.propertyToZod(v);
        }
        let objSchema: z.ZodTypeAny = z.object(objShape);
        if (prop.required && prop.required.length > 0) {
          const requiredShape: Record<string, true> = {};
          for (const key of prop.required) {
            requiredShape[key] = true;
          }
          objSchema = (objSchema as any).required(requiredShape);
        }
        return prop.required ? objSchema : objSchema.optional();
      }

      default:
        return z.unknown();
    }
  }
}

export const toolRegistry = new ToolRegistryImpl();

// Helper to create tool definitions with proper typing
export function createTool<T extends Record<string, unknown>>(
  definition: Omit<ToolDefinition, 'execute'> & {
    execute: (args: T, context: ToolExecutionContext) => Promise<ToolResult>;
  }
): ToolDefinition {
  return definition as ToolDefinition;
}