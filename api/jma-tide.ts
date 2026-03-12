import type { VercelRequest, VercelResponse } from "@vercel/node";

type TideEvent = {
  time: string;
  levelCm: number | null;
};

type SuccessResponse = {
  source: "jma-html";
  stationCode: string;
  stationName: string;
  date: string;
  highs: TideEvent[];
  lows: TideEvent[];
  fetchedAt: string;
};

type ErrorResponse = {
  error: string;
  detail?: string;
};

const JMA_STATION_MAP: Record<string, { code: string; name: string }> = {
  hoshiga: { code: "KA", name: "唐津" },
  funakoshi: { code: "KA", name: "唐津" },
  seiga: { code: "KA", name: "唐津" }
};

function sendError(
  res: VercelResponse,
  status: number,
  error: string,
  detail?: string
) {
  return res.status(status).json(detail ? { error, detail } : { error });
}

function normalizeSpot(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toJmaDateText(date: string): string {
  return date.replaceAll("-", "/");
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padTime(value: string): string {
  const [h, m] = value.split(":");
  return `${String(h).padStart(2, "0")}:${m}`;
}

function uniqEvents(events: TideEvent[]): TideEvent[] {
  const seen = new Set<string>();
  const out: TideEvent[] = [];
  for (const ev of events) {
    const key = `${ev.time}_${ev.levelCm ?? "null"}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ev);
    }
  }
  return out;
}

function parseDayFromText(pageText: string, date: string) {
  const dateText = toJmaDateText(date);

  const nextDay = new Date(`${date}T00:00:00+09:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const yyyy = nextDay.getFullYear();
  const mm = String(nextDay.getMonth() + 1).padStart(2, "0");
  const dd = String(nextDay.getDate()).padStart(2, "0");
  const nextDateText = `${yyyy}/${mm}/${dd}`;

  const startIdx = pageText.indexOf(dateText);
  if (startIdx < 0) {
    throw new Error(`Date not found in JMA page: ${dateText}`);
  }

  let endIdx = pageText.indexOf(nextDateText, startIdx + dateText.length);
  if (endIdx < 0) endIdx = Math.min(pageText.length, startIdx + 500);

  const chunk = pageText.slice(startIdx, endIdx);

  // 日付の直後に並ぶ「時刻 潮位」または "*" を順番に読む
  const tokenRegex = /(\d{1,2}:\d{2})\s+(-?\d+)|\*/g;
  const tokens: Array<TideEvent | null> = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(chunk)) !== null) {
    if (match[0] === "*") {
      tokens.push(null);
    } else {
      tokens.push({
        time: padTime(match[1]),
        levelCm: Number(match[2])
      });
    }
  }

  // JMA表は1日分について
  // 満潮 4枠 + 干潮 4枠
  // の順に並んでいるので、最初の8枠だけ見る
  const first8 = tokens.slice(0, 8);

  const highs = uniqEvents(
    first8.slice(0, 4).filter(Boolean) as TideEvent[]
  );

  const lows = uniqEvents(
    first8.slice(4, 8).filter(Boolean) as TideEvent[]
  );

  return { highs, lows, rawChunk: chunk };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendError(res, 405, "Method Not Allowed");
  }

  try {
    const spot = normalizeSpot(req.query.spot || "hoshiga");
    const date = String(req.query.date || "").trim();

    if (!JMA_STATION_MAP[spot]) {
      return sendError(res, 400, `Unknown spot: ${spot}`);
    }

    if (!date) {
      return sendError(res, 400, "Missing date");
    }

    if (!isValidDate(date)) {
      return sendError(res, 400, "Invalid date format", "Use YYYY-MM-DD");
    }

    const station = JMA_STATION_MAP[spot];
    const url = `https://www.data.jma.go.jp/kaiyou/db/tide/suisan/suisan.php?stn=${station.code}`;

    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 tide-app/1.0",
        "Accept": "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache"
      }
    });

    const html = await upstream.text();

    if (!upstream.ok) {
      return sendError(res, upstream.status, "JMA fetch failed", html.slice(0, 500));
    }

    const text = cleanHtml(html);
    const parsed = parseDayFromText(text, date);

    return res.status(200).json({
      source: "jma-html",
      stationCode: station.code,
      stationName: station.name,
      date,
      highs: parsed.highs,
      lows: parsed.lows,
      fetchedAt: new Date().toISOString()
    });
  } catch (err: any) {
    return sendError(
      res,
      500,
      "Internal server error",
      err?.message || String(err)
    );
  }
}
