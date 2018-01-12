import * as fs from 'fs'
import * as path from 'path'

import {
  CONFIG_SEARCH_PATHS,
  DEFAULT_CONFIG_PATH,
  DEFAULT_ENVIRONMENT,
  SUPPORTED_FILE_TYPES,
} from './constants'

import {
  ConfigBuilder,
  ObjectUtils,
  PromiseUtils,
} from './utils'

import {
  IRootConfigValue,
} from './types'

function readFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err: any, data: Buffer) => {
      if (err) {
        reject(err)
      } else {
        resolve(data.toString('utf-8'))
      }
    })
  })
}

// Should we fail if one file fails?
function parseContent<T>(content: string): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      resolve(JSON.parse(content))
    } catch (e) {
      reject(e)
    }
  })
}

function getConfigPath(sourceDir: string): string {
  const firstPath: string = path.resolve(process.cwd(), sourceDir)
  if (fs.existsSync(firstPath) && fs.statSync(firstPath).isDirectory) {
    return firstPath
  } else {
    for (const next of CONFIG_SEARCH_PATHS) {
      const nextPath: string = path.resolve(process.cwd(), next, sourceDir)
      if (fs.existsSync(nextPath) && fs.statSync(nextPath).isDirectory) {
        return nextPath
      }
    }
  }

  throw new Error('No local config directory found')
}

async function loadFileWithName(configPath: string, name: string): Promise<IRootConfigValue> {
  const configs: Array<object> = await PromiseUtils.valuesForPromises(SUPPORTED_FILE_TYPES.map((ext: string) => {
    const filePath: string = path.resolve(configPath, `${name}.${ext}`)
    return readFile(filePath).then((content: string) => {
      switch (ext) {
        case 'js': {
          const configObj = require(filePath)

          if (typeof configObj.default === 'object') {
            return configObj.default
          } else {
            return configObj
          }
        }

        case 'ts': {
          require('ts-node').register({
            lazy: true,
            compilerOptions: {
              allowJs: true,
              rootDir: '.',
            },
          })

          const configObj = require(filePath)

          if (typeof configObj.default === 'object') {
            return configObj.default
          } else {
            return configObj
          }
        }

        default:
          return (parseContent(content) as any)
      }
    }, (err: any) => {
      return {}
    })
  }))

  return (ObjectUtils.overlayObjects(...configs.map((next: any): IRootConfigValue => {
    return ConfigBuilder.createConfigObject(name, 'local', next)
  })) as IRootConfigValue)
}

export interface ILoaderConfig {
  configPath?: string
  configEnv?: string
}

export class ConfigLoader {
  private configPath: string
  private configEnv: string
  private savedConfig: IRootConfigValue

  constructor({ configPath = DEFAULT_CONFIG_PATH, configEnv }: ILoaderConfig = {}) {
    this.configPath = getConfigPath(configPath)
    this.configEnv = configEnv || process.env.NODE_ENV || DEFAULT_ENVIRONMENT
  }

  /**
   * Loads default JSON config file. This is required.
   */
  public async loadDefault(): Promise<IRootConfigValue> {
    return loadFileWithName(this.configPath, 'default')
  }

  /**
   * Loads JSON config file based on NODE_ENV.
   */
  public async loadEnvironment(): Promise<IRootConfigValue> {
    return loadFileWithName(this.configPath, this.configEnv)
  }

  /**
   * Returns the overlay of the default and environment local config.
   */
  public async resolve(): Promise<IRootConfigValue> {
    if (this.savedConfig !== undefined) {
      return Promise.resolve(this.savedConfig)
    } else {
      const defaultConfig: any = await this.loadDefault()
      const envConfig: any = await this.loadEnvironment()
      this.savedConfig = ObjectUtils.overlayObjects(defaultConfig, envConfig)
      return this.savedConfig
    }
  }
}