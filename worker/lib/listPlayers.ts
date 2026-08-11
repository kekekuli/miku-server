/**
 * Parser for the Squad 44 RCON `ListPlayers` response.
 *
 * Sample response (real output, note the edge cases called out below):
 *
 *   ----- Active Players -----
 *   ID: 0 | SteamID: N/A | Name:
 *   ID: 4 | SteamID: 76561199875730259 | Name: 何意味山炮团-Jack杰克
 *   ID: 0 | SteamID: 76561199451057588 | Name: 何意味装甲师-埃尔温  隆美尔[Erwin Romme
 *
 *   ----- Recently Disconnected Players [Max of 15] -----
 *   ID: 2 | SteamID: 76561198983569858 | Since Disconnect: 02m.01s | Name: 駒井健一郎
 *
 * Three properties of the format drive the implementation:
 *
 * 1. `Name` is always the final field, and names are free text — they can contain
 *    `|`, `=`, `[`, runs of spaces, and are truncated mid-word by the server. So the
 *    name is taken as the rest of the line after the `| Name:` marker rather than by
 *    splitting on `|`.
 * 2. The leading `ID` is a transient slot index, NOT a stable key — the same ID can
 *    appear twice in one response. Players are keyed on SteamID instead.
 * 3. A connecting player appears as `SteamID: N/A` with an empty name. Those are
 *    reported separately rather than being emitted as nameless players.
 *
 * Fields before `Name` are parsed generically into a key/value map, so a future game
 * update that adds `Team ID` / `Squad ID` / `Role` will not break parsing.
 */

const SECTION_ACTIVE = /^-+\s*Active Players\s*-+\s*$/i;
const SECTION_DISCONNECTED = /^-+\s*Recently Disconnected Players/i;
const NAME_FIELD = /\|\s*Name:\s?/;
const STEAM_ID_64 = /^\d{17}$/;

export interface ListPlayersEntry {
  /** Server slot index. Not unique — do not use as a key. Null if unparseable. */
  id: number | null;
  /** Steam64 ID, or null while the player is still connecting (`SteamID: N/A`). */
  steamId: string | null;
  /** In-game name. May be empty, and is truncated by the server at ~32 chars. */
  name: string;
  /** Only present in the disconnected section, e.g. `02m.01s`. */
  sinceDisconnect?: string;
}

export interface ListPlayersResult {
  /** Players with a resolved SteamID, deduplicated. */
  active: ListPlayersEntry[];
  /** Recently disconnected players, as reported by the server. */
  disconnected: ListPlayersEntry[];
  /** Slots occupied by players who have not finished connecting (`SteamID: N/A`). */
  connecting: number;
  /**
   * False when the response contained no recognisable section header, which means
   * the format drifted or the server returned an error string. Callers must not
   * treat `active: []` with `ok: false` as "the server is empty".
   */
  ok: boolean;
}

function parseLine(line: string): ListPlayersEntry | null {
  const nameField = NAME_FIELD.exec(line);
  if (!nameField) return null;

  // Everything after `| Name:` is the name — it may itself contain `|`.
  const name = line.slice(nameField.index + nameField[0].length).trim();

  const fields = new Map<string, string>();
  for (const part of line.slice(0, nameField.index).split('|')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    fields.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }

  const rawId = fields.get('id');
  const rawSteamId = fields.get('steamid');
  const sinceDisconnect = fields.get('since disconnect');

  return {
    id: rawId !== undefined && /^\d+$/.test(rawId) ? Number(rawId) : null,
    steamId: rawSteamId && STEAM_ID_64.test(rawSteamId) ? rawSteamId : null,
    name,
    ...(sinceDisconnect ? { sinceDisconnect } : {}),
  };
}

export function parseListPlayers(raw: string): ListPlayersResult {
  const active: ListPlayersEntry[] = [];
  const disconnected: ListPlayersEntry[] = [];
  const seen = new Set<string>();
  let connecting = 0;
  let section: 'active' | 'disconnected' | null = null;
  let sawSection = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (SECTION_ACTIVE.test(line)) {
      section = 'active';
      sawSection = true;
      continue;
    }
    if (SECTION_DISCONNECTED.test(line)) {
      section = 'disconnected';
      sawSection = true;
      continue;
    }
    if (section === null) continue; // preamble, e.g. an echoed command

    const entry = parseLine(rawLine);
    if (!entry) continue;

    if (section === 'disconnected') {
      disconnected.push(entry);
      continue;
    }

    if (entry.steamId === null) {
      connecting++;
      continue;
    }
    // The same slot can be reported twice in one response.
    if (seen.has(entry.steamId)) continue;
    seen.add(entry.steamId);
    active.push(entry);
  }

  return { active, disconnected, connecting, ok: sawSection };
}
