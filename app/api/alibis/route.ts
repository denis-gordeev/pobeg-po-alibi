import { createAlibiPackage } from "../../../lib/alibis";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { origin?: string; destination?: string; date?: string; reason?: string; customAlibi?: string };
    const origin = body.origin?.trim();
    const destination = body.destination?.trim();
    const date = body.date;
    const custom = body.customAlibi?.trim() || "";
    if (!origin || origin.length > 80 || !destination || destination.length > 80) {
      return Response.json({ error: "Укажите нормальные города маршрута" }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Дата выглядит подозрительно" }, { status: 400 });
    }
    if (custom.length > 600) {
      return Response.json({ error: "Черновик алиби должен быть короче 600 символов" }, { status: 400 });
    }

    return Response.json(await createAlibiPackage({ origin, destination, date, reasonKey: body.reason || "meeting", custom }));
  } catch {
    return Response.json({ error: "Штаб не смог обновить алиби. Попробуйте ещё раз." }, { status: 500 });
  }
}
