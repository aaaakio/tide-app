import type { VercelRequest, VercelResponse } from "@vercel/node";

const STATION_MAP: Record<string, { stationCode: string; stationName: string }> = {
  seiga: { stationCode: "4101", stationName: "唐津" },
  funakoshi: { stationCode: "4101", stationName: "唐津" },
};

function yyyymmddJst(date = new Date()) {
  const jst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const key = process.env.MSIL_SUBSCRIPTION_KEY;
  if (!key) {
    return res.status(500).json({ error: "Missing MSIL_SUBSCRIPTION_KEY" });
  }

  const spot = String(req.query.spot ?? "seiga");
  const stationMeta = STATION_MAP[spot];

  if (!stationMeta) {
    return res.status(400).json({ error: `Unknown spot: ${spot}` });
  }

  const stationCode = String(req.query.stationCode ?? stationMeta.stationCode);
  const date = String(req.query.date ?? yyyymmddJst());

  const url = new URL("https://api.msil.go.jp/tide-prediction/v3/data");
  url.searchParams.set("stationCode", stationCode);
  url.searchParams.set("date", date);

  const upstream = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      error: "MSIL upstream error",
      body: text.slice(0, 2000),
    });
  }

  const raw = JSON.parse(text);

  return res.status(200).json({
    source: "msil",
    stationName: stationMeta.stationName,
    stationCode: raw.stationCode,
    time: raw.time,
    interval: raw.interval,
    tide: raw.tide,
    fetchedAt: new Date().toISOString(),
  });
}
