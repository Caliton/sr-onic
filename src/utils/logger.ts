import fs from 'fs';
import path from 'path';
import { config } from '../config';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export class Logger {
  private static instance: Logger;
  private logDir: string;
  private maxSizeBytes: number;
  private currentLogFile: string = '';

  private constructor() {
    this.logDir = config.logging.dir;
    this.maxSizeBytes = config.logging.maxSizeMb * 1024 * 1024;
    this.ensureLogDir();
    this.rotateLogFile();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getDateStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  private rotateLogFile(): void {
    const dateStr = this.getDateStr();
    this.currentLogFile = path.join(this.logDir, `sronic-${dateStr}.log`);

    if (fs.existsSync(this.currentLogFile)) {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= this.maxSizeBytes) {
        const rotated = path.join(this.logDir, `sronic-${dateStr}-${Date.now()}.log`);
        fs.renameSync(this.currentLogFile, rotated);
      }
    }
  }

  private formatMessage(level: LogLevel, module: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}][${level}][${module}] ${message}`;
  }

  private writeToFile(formatted: string): void {
    try {
      const currentDate = this.getDateStr();
      const expectedFile = path.join(this.logDir, `sronic-${currentDate}.log`);
      if (this.currentLogFile !== expectedFile) {
        this.rotateLogFile();
      }

      fs.appendFileSync(this.currentLogFile, formatted + '\n');
    } catch {
      // Silently fail file writes — console output still works
    }
  }

  public log(level: LogLevel, module: string, message: string): void {
    const formatted = this.formatMessage(level, module, message);

    // Console output
    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }

    // File output
    this.writeToFile(formatted);
  }

  public debug(module: string, message: string): void {
    this.log(LogLevel.DEBUG, module, message);
  }

  public info(module: string, message: string): void {
    this.log(LogLevel.INFO, module, message);
  }

  public warn(module: string, message: string): void {
    this.log(LogLevel.WARN, module, message);
  }

  public error(module: string, message: string): void {
    this.log(LogLevel.ERROR, module, message);
  }
}

export const logger = Logger.getInstance();
