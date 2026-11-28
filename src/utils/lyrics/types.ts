// Ported from folia-web <https://github.com/folia-ce/folia-web> (src/utils/lyrics/types.ts).
// Copyright (C) chthollyphile and folia-ce contributors.
// Licensed under AGPL-3.0-or-later — see NOTICE.md in this directory.
// Modifications: dropped folia's multi-source RawLyricSource contracts (embedded /
// netease / navidrome / qrc adapters); Firefly only feeds raw text into the parsers.

import type { LyricData } from "./lyricData";
import type { LyricParseFormat } from "./parserCore";

export type UnifiedLyric = LyricData;

export interface LyricProcessingOptions {
	includeInterludes?: boolean;
	songId?: number;
	fetchChorusRanges?: (
		songId: number,
	) => Promise<Array<{ startTime: number; endTime: number }>>;
}

export type { LyricParseFormat };
