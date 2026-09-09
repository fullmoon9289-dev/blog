import { NextResponse } from "next/server";
import { getUsage, publishedToday, minutesSinceLastPublish } from "@/lib/ai/cfUsage";
import { getSettings } from "@/lib/settings";
import { neuronsPerImage, imagesPerFreeDay } from "@/lib/ai/neurons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = getSettings();
  return NextResponse.json({
    neurons: await getUsage(),
    perImage: neuronsPerImage(s.cfImageSteps),
    imagesPerDay: imagesPerFreeDay(s.cfImageSteps),
    publishedToday: publishedToday(),
    dailyLimit: s.dailyPublishLimit,
    minutesSinceLastPublish: minutesSinceLastPublish(),
    minIntervalMin: s.minPublishIntervalMin,
  });
}
