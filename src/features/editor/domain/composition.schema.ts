import { Composition } from './editor.types';

export function isComposition(value: unknown): value is Composition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const composition = value as Partial<Composition>;
  return (
    composition.version === 1 &&
    typeof composition.id === 'string' &&
    typeof composition.projectId === 'string' &&
    typeof composition.clipId === 'string' &&
    typeof composition.durationMs === 'number' &&
    composition.durationMs >= 0 &&
    typeof composition.revision === 'number' &&
    Array.isArray(composition.tracks) &&
    Boolean(composition.layout)
  );
}

export function assertComposition(value: unknown): asserts value is Composition {
  if (!isComposition(value)) {
    throw new Error('Composicao invalida.');
  }
}
