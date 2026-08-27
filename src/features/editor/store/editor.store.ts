import type { CanvasPreset, CaptionSettings, Composition, Region, Track, TrackItem, Transform } from '../domain/editor.types';
import { DEFAULT_TRANSFORM, getLayoutPreset } from '../domain/layout';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type EditorState = {
  composition: Composition | null;
  past: Composition[];
  future: Composition[];
  selectedItemId: string | null;
  playheadMs: number;
  isDirty: boolean;
  saveState: SaveState;
};

export type EditorAction =
  | { type: 'load'; composition: Composition }
  | { type: 'select-item'; itemId: string }
  | { type: 'set-playhead'; playheadMs: number }
  | { type: 'set-save-state'; saveState: SaveState }
  | { type: 'sync-revision'; revision: number; updatedAt: string }
  | { type: 'update-title'; title: string }
  | { type: 'set-layout-preset'; preset: CanvasPreset }
  | { type: 'update-canvas-size'; width: number; height: number }
  | { type: 'update-layout-settings'; background?: string; showSafeArea?: boolean }
  | { type: 'update-caption-settings'; settings: Partial<CaptionSettings> }
  | { type: 'update-region'; regionId: string; values: Partial<Pick<Region, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>> }
  | { type: 'update-transform'; itemId: string; transform: Partial<Transform> }
  | { type: 'reset-transform'; itemId: string }
  | { type: 'add-image'; assetId: string }
  | { type: 'trim-item'; itemId: string; sourceInMs: number; sourceOutMs: number }
  | { type: 'split-item'; itemId: string; splitAtMs: number }
  | { type: 'delete-item'; itemId: string }
  | { type: 'duplicate-item'; itemId: string }
  | { type: 'move-item'; itemId: string; direction: 'up' | 'down' }
  | { type: 'restore'; composition: Composition }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'mark-saved'; composition: Composition };

const MAX_HISTORY = 50;

const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  mode: 'automatic',
  manualText: '',
  corrections: '',
  font: 'inter',
  position: 'bottom',
  displayMode: 'block',
  language: 'pt-BR',
};

function cloneComposition(composition: Composition): Composition {
  return JSON.parse(JSON.stringify(composition)) as Composition;
}

function getVideoTrack(composition: Composition): Track {
  return composition.tracks.find((track) => track.kind === 'video') || {
    id: `${composition.id}-video`,
    kind: 'video',
    items: [],
  };
}

function getVisualItems(composition: Composition): TrackItem[] {
  return composition.tracks
    .filter((track) => track.kind === 'video' || track.kind === 'media')
    .flatMap((track) => track.items);
}

function getVisualTrackIndex(composition: Composition, itemId: string) {
  return composition.tracks.findIndex(
    (track) => (track.kind === 'video' || track.kind === 'media') && track.items.some((item) => item.id === itemId),
  );
}

function reflowItems(items: TrackItem[]) {
  let timelineStartMs = 0;

  return items.map((item) => {
    const nextItem = { ...item, timelineStartMs };
    timelineStartMs += Math.max(item.sourceOutMs - item.sourceInMs, 100);
    return nextItem;
  });
}

function withVideoItems(composition: Composition, items: TrackItem[]): Composition {
  const durationMs = items.reduce(
    (total, item) => total + Math.max(item.sourceOutMs - item.sourceInMs, 100),
    0,
  );
  const tracks = composition.tracks.map((track) =>
    track.kind === 'video'
      ? { ...track, items }
      : track.kind === 'media'
        ? { ...track, items: track.items.map((item) => ({ ...item, sourceOutMs: durationMs })) }
        : track,
  );

  return {
    ...composition,
    tracks,
    durationMs,
    status: composition.status === 'suggested' ? 'editing' : composition.status,
    updatedAt: new Date().toISOString(),
  };
}

function pushHistory(state: EditorState, composition: Composition): EditorState {
  const past = [...state.past, cloneComposition(composition)].slice(-MAX_HISTORY);
  return { ...state, past, future: [], isDirty: true, saveState: 'idle' };
}

function selectedIndex(items: TrackItem[], itemId: string) {
  return items.findIndex((item) => item.id === itemId);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function withLayoutEdit(state: EditorState, nextComposition: Composition): EditorState {
  return {
    ...pushHistory(state, state.composition!),
    composition: {
      ...nextComposition,
      status: nextComposition.status === 'suggested' ? 'editing' : nextComposition.status,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function createEditorState(composition: Composition): EditorState {
  const firstItem = getVisualItems(composition)[0];
  return {
    composition,
    past: [],
    future: [],
    selectedItemId: firstItem?.id || null,
    playheadMs: 0,
    isDirty: false,
    saveState: 'saved',
  };
}

export const initialEditorState: EditorState = {
  composition: null,
  past: [],
  future: [],
  selectedItemId: null,
  playheadMs: 0,
  isDirty: false,
  saveState: 'idle',
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'load') {
    return createEditorState(action.composition);
  }

  if (action.type === 'select-item') {
    return { ...state, selectedItemId: action.itemId };
  }

  if (action.type === 'set-playhead') {
    const maxPlayhead = state.composition?.durationMs || 0;
    return { ...state, playheadMs: Math.min(maxPlayhead, Math.max(0, action.playheadMs)) };
  }

  if (action.type === 'set-save-state') {
    return { ...state, saveState: action.saveState };
  }

  if (action.type === 'mark-saved') {
    return { ...state, composition: action.composition, isDirty: false, saveState: 'saved' };
  }

  if (action.type === 'sync-revision') {
    if (!state.composition) {
      return state;
    }

    return {
      ...state,
      composition: {
        ...state.composition,
        revision: action.revision,
        updatedAt: action.updatedAt,
      },
      saveState: 'idle',
    };
  }

  if (!state.composition) {
    return state;
  }

  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) {
      return state;
    }

    const past = state.past.slice(0, -1);
    const current = cloneComposition(state.composition);
    const items = getVideoTrack(previous).items;
    return {
      ...state,
      composition: previous,
      past,
      future: [current, ...state.future].slice(0, MAX_HISTORY),
      selectedItemId: getVisualItems(previous)[0]?.id || null,
      playheadMs: Math.min(state.playheadMs, previous.durationMs),
      isDirty: true,
      saveState: 'idle',
    };
  }

  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) {
      return state;
    }

    const current = cloneComposition(state.composition);
    const items = getVideoTrack(next).items;
    return {
      ...state,
      composition: next,
      past: [...state.past, current].slice(-MAX_HISTORY),
      future: state.future.slice(1),
      selectedItemId: getVisualItems(next)[0]?.id || null,
      playheadMs: Math.min(state.playheadMs, next.durationMs),
      isDirty: true,
      saveState: 'idle',
    };
  }

  if (action.type === 'restore') {
    return {
      ...pushHistory(state, state.composition),
      composition: cloneComposition(action.composition),
      selectedItemId: getVisualItems(action.composition)[0]?.id || null,
      playheadMs: 0,
    };
  }

  if (action.type === 'update-title') {
    return {
      ...pushHistory(state, state.composition),
      composition: {
        ...state.composition,
        title: action.title,
        updatedAt: new Date().toISOString(),
        status: state.composition.status === 'suggested' ? 'editing' : state.composition.status,
      },
    };
  }

  if (action.type === 'set-layout-preset') {
    const preset = getLayoutPreset(action.preset);
    const isCustom = action.preset === 'custom';
    const nextComposition = {
      ...state.composition,
      canvas: isCustom
        ? state.composition.canvas
        : {
            ...state.composition.canvas,
            width: preset.width,
            height: preset.height,
          },
      layout: {
        ...state.composition.layout,
        preset: action.preset,
        name: isCustom ? 'Formato personalizado' : preset.label,
      },
    };
    return withLayoutEdit(state, nextComposition);
  }

  if (action.type === 'update-canvas-size') {
    const nextComposition = {
      ...state.composition,
      canvas: {
        ...state.composition.canvas,
        width: Math.round(clamp(action.width, 320, 3840)),
        height: Math.round(clamp(action.height, 320, 3840)),
      },
      layout: {
        ...state.composition.layout,
        preset: 'custom' as const,
        name: 'Formato personalizado',
      },
    };
    return withLayoutEdit(state, nextComposition);
  }

  if (action.type === 'update-layout-settings') {
    const nextComposition = {
      ...state.composition,
      layout: {
        ...state.composition.layout,
        ...(action.background === undefined ? {} : { background: action.background }),
        ...(action.showSafeArea === undefined ? {} : { showSafeArea: action.showSafeArea }),
      },
    };
    return withLayoutEdit(state, nextComposition);
  }

  if (action.type === 'update-caption-settings') {
    return withLayoutEdit(state, {
      ...state.composition,
      captionSettings: {
        ...DEFAULT_CAPTION_SETTINGS,
        ...(state.composition.captionSettings || {}),
        ...action.settings,
      },
      captionTrack: undefined,
    });
  }

  if (action.type === 'update-region') {
    const nextRegions = state.composition.layout.regions.map((region) => {
      if (region.id !== action.regionId) {
        return region;
      }

      const nextRegion = { ...region, ...action.values };
      const widthPct = clamp(nextRegion.widthPct, 5, 100);
      const heightPct = clamp(nextRegion.heightPct, 5, 100);
      return {
        ...nextRegion,
        widthPct,
        heightPct,
        xPct: clamp(nextRegion.xPct, 0, 100 - widthPct),
        yPct: clamp(nextRegion.yPct, 0, 100 - heightPct),
      };
    });
    return withLayoutEdit(state, {
      ...state.composition,
      layout: { ...state.composition.layout, regions: nextRegions },
    });
  }

  if (action.type === 'add-image') {
    const mediaItem: TrackItem = {
      id: `image-${action.assetId}-${Date.now()}`,
      assetId: action.assetId,
      sourceInMs: 0,
      sourceOutMs: Math.max(state.composition.durationMs, 100),
      timelineStartMs: 0,
      regionId: state.composition.layout.regions[0]?.id || 'main',
      mediaType: 'image',
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: 0.35,
        cropMode: 'contain',
      },
    };
    const mediaTrack = state.composition.tracks.find((track) => track.kind === 'media');
    const tracks = mediaTrack
      ? state.composition.tracks.map((track) => track.kind === 'media' ? { ...track, items: [...track.items, mediaItem] } : track)
      : [
          ...state.composition.tracks,
          { id: `${state.composition.id}-media`, kind: 'media' as const, items: [mediaItem] },
        ];
    const nextState = withLayoutEdit(state, { ...state.composition, tracks });
    return { ...nextState, selectedItemId: mediaItem.id };
  }

  if (action.type === 'update-transform' || action.type === 'reset-transform') {
    const visualTrackIndex = getVisualTrackIndex(state.composition, action.itemId);
    if (visualTrackIndex === -1) {
      return state;
    }

    const currentTrack = state.composition.tracks[visualTrackIndex];
    const currentItems = currentTrack.items;
    const itemIndex = selectedIndex(currentItems, action.itemId);
    if (itemIndex === -1) {
      return state;
    }

    const currentItem = currentItems[itemIndex];
    const minimumScale = currentItem.mediaType === 'image' ? 0.1 : 0.5;
    const nextTransform = action.type === 'reset-transform'
      ? { ...currentItem.transform, x: 0, y: 0, scale: 1, rotation: 0, cropMode: 'cover' as const }
      : {
          ...currentItem.transform,
          ...action.transform,
          x: clamp(Number(action.transform.x ?? currentItem.transform.x), -100, 100),
          y: clamp(Number(action.transform.y ?? currentItem.transform.y), -100, 100),
          scale: clamp(Number(action.transform.scale ?? currentItem.transform.scale), minimumScale, 3),
          rotation: clamp(Number(action.transform.rotation ?? currentItem.transform.rotation ?? 0), -180, 180),
        };
    const nextItems = currentItems.map((item, index) =>
      index === itemIndex ? { ...item, transform: nextTransform } : item,
    );
    const nextTracks = state.composition.tracks.map((track, index) =>
      index === visualTrackIndex ? { ...track, items: nextItems } : track,
    );
    return withLayoutEdit(state, { ...state.composition, tracks: nextTracks });
  }

  const currentTrack = getVideoTrack(state.composition);
  const currentItems = currentTrack.items;

  if (action.type === 'trim-item') {
    const index = selectedIndex(currentItems, action.itemId);
    if (index === -1) {
      return state;
    }

    const item = currentItems[index];
    const sourceInMs = Math.max(0, Math.min(action.sourceInMs, item.sourceOutMs - 100));
    const sourceOutMs = Math.max(sourceInMs + 100, action.sourceOutMs);
    const nextItems = reflowItems(
      currentItems.map((currentItem, currentIndex) =>
        currentIndex === index ? { ...currentItem, sourceInMs, sourceOutMs } : currentItem,
      ),
    );
    const nextComposition = withVideoItems(state.composition, nextItems);
    return { ...pushHistory(state, state.composition), composition: nextComposition };
  }

  if (action.type === 'split-item') {
    const index = selectedIndex(currentItems, action.itemId);
    if (index === -1) {
      return state;
    }

    const item = currentItems[index];
    const localOffset = action.splitAtMs - item.timelineStartMs;
    const splitSourceMs = item.sourceInMs + localOffset;
    if (localOffset < 100 || localOffset > item.sourceOutMs - item.sourceInMs - 100) {
      return state;
    }

    const first = { ...item, id: `${item.id}-a`, sourceOutMs: splitSourceMs };
    const second = { ...item, id: `${item.id}-b`, sourceInMs: splitSourceMs };
    const nextItems = reflowItems([...currentItems.slice(0, index), first, second, ...currentItems.slice(index + 1)]);
    const nextComposition = withVideoItems(state.composition, nextItems);
    return {
      ...pushHistory(state, state.composition),
      composition: nextComposition,
      selectedItemId: second.id,
      playheadMs: second.timelineStartMs,
    };
  }

  if (action.type === 'delete-item') {
    if (currentItems.length <= 1) {
      return state;
    }

    const index = selectedIndex(currentItems, action.itemId);
    if (index === -1) {
      return state;
    }

    const nextItems = reflowItems(currentItems.filter((item) => item.id !== action.itemId));
    const nextComposition = withVideoItems(state.composition, nextItems);
    return {
      ...pushHistory(state, state.composition),
      composition: nextComposition,
      selectedItemId: nextItems[Math.min(index, nextItems.length - 1)]?.id || null,
      playheadMs: 0,
    };
  }

  if (action.type === 'duplicate-item') {
    const index = selectedIndex(currentItems, action.itemId);
    if (index === -1) {
      return state;
    }

    const item = currentItems[index];
    const duplicate = { ...item, id: `${item.id}-copy-${Date.now()}` };
    const nextItems = reflowItems([...currentItems.slice(0, index + 1), duplicate, ...currentItems.slice(index + 1)]);
    const nextComposition = withVideoItems(state.composition, nextItems);
    return {
      ...pushHistory(state, state.composition),
      composition: nextComposition,
      selectedItemId: duplicate.id,
    };
  }

  if (action.type === 'move-item') {
    const index = selectedIndex(currentItems, action.itemId);
    const nextIndex = action.direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || nextIndex < 0 || nextIndex >= currentItems.length) {
      return state;
    }

    const nextItems = [...currentItems];
    [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
    const nextComposition = withVideoItems(state.composition, reflowItems(nextItems));
    return { ...pushHistory(state, state.composition), composition: nextComposition };
  }

  return state;
}
