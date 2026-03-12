import type { NextApiRequest, NextApiResponse } from "next";

type ErrorResponse = {
  error: string;
  detail?: string;
};

type SpotConfig = {
  label: string;
  stationCode: string;
};

const SPOT_MAP: Record<string, SpotConfig> = {
  hoshiga: {
    label: "星賀",
    stationCode: "4101",
  },
  funakoshi: {
    label: "船越",
    stationCode: "4101",
  },
  seiga: {
    label: "星賀",
    stationCode: "4101",
  },
};

function sendError(
  res: NextApiResponse<ErrorResponse>,
  status: number,
  error: string,
  detail?: string
) {
  return res.status(status).json(detail ? { error, detail } : { error });
}

function normalizeSpot(rawSpot: unknown): string {
  return String(rawSpot || "").trim().toLowerCase();
}

function isValidDate(date: string): boolean {
  return /^\d{8}$/.test(date);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return sendError(res, 405, "Method not allowed");
  }

  try {
    const rawSpot = normalizeSpot(req.query.spot);
    const date = String(req.query.date || "").trim();

    if (!rawSpot) {
      return sendError(res, 400, "Missing spot");
    }

    if (!date) {
      return sendError(res, 400, "Missing date");
    }

    if (!isValidDate(date)) {
      return sendError(res, 400, "Invalid date format", "date must be YYYYMMDD");
    }

    const spotConfig = SPOT_MAP[rawSpot];
    if (!spotConfig) {
      return sendError(res, 400, `Unknown spot: ${rawSpot}`);
    }

    const subscriptionKey = process.env.MSIL_SUBSCRIPTION_KEY;
    if (!subscriptionKey) {
      return sendError(
        res,
        500,
        "Missing environment variable",
        "MSIL_SUBSCRIPTION_KEY is not set"
      );
    }

    // ここが重要修正
    const baseUrl = "https://api.msil.go.jp/data";
    const url = `${baseUrl}?stationCode=${encodeURIComponent(
      spotConfig.stationCode
    )}&date=${encodeURIComponent(date)}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": subscriptionKey,
        "Accept": "application/json",
      },
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return sendError(
        res,
        upstream.status,
        "MSIL request failed",
        text.slice(0, 500)
      );
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return sendError(
        res,
        502,
        "Invalid JSON from MSIL",
        text.slice(0, 500)
      );
    }

    return res.status(200).json({
      ...data,
      requestedSpot: rawSpot,
      normalizedSpot: rawSpot === "seiga" ? "hoshiga" : rawSpot,
      spotLabel: spotConfig.label,
      stationCode: spotConfig.stationCode,
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
