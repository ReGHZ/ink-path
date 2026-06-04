import {
    createContainer,
    InjectionMode,
    type AwilixContainer,
} from 'awilix'

export type AppCradle = Record<never, never>

export function createAppContainer(): AwilixContainer<AppCradle> {
    return createContainer<AppCradle>({
        injectionMode: InjectionMode.PROXY,
        strict: true,
    })
}