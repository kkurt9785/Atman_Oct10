
'use server';

import { requireAdminContext } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';

export type CheckinResult =
  | {
      ok: true;
      workerName: string;
      shiftDate: string;
      startTime: string;
      action: 'checkin' | 'checkout';
      gross?: number;
      platformFee?: number;
      charged?: number;
      netPay?: number;
      balance?: number;
      distanceM?: number | null;
    }
  | { ok: false; message: string };

export type CheckinCoords = { lat: number; lng: number } | null;

type RpcResult = {
  action?: unknown;
  workerName?: unknown;
  shiftDate?: unknown;
  startTime?: unknown;
  gross?: unknown;
  platformFee?: unknown;
  charged?: unknown;
  netPay?: unknown;
  balance?: unknown;
  distanceM?: unknown;
};

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function recordCheckin(
  token: string,
  coords: CheckinCoords = null,
): Promise<CheckinResult> {
  try {
    if (!token || token.length < 32) {
      return { ok: false, message: '유효하지 않은 QR이에요.' };
    }

    const context = await requireAdminContext(['owner', 'operator', 'super']);
    const sb = userClient(context.accessToken);
    if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };

    const { data, error } = await sb.rpc('consume_attendance_qr', {
      p_token: token,
      p_facility_id: context.facilityId,
      p_lat: coords?.lat ?? null,
      p_lng: coords?.lng ?? null,
    });

  nudgeNotificationDispatch();

    if (error) {
      return { ok: false, message: error.message || 'QR 처리에 실패했어요.' };
    }

    const result = (data ?? {}) as RpcResult;
    if (
      (result.action !== 'checkin' && result.action !== 'checkout')
      || typeof result.workerName !== 'string'
      || typeof result.shiftDate !== 'string'
      || typeof result.startTime !== 'string'
    ) {
      return { ok: false, message: '서버 응답을 확인할 수 없어요.' };
    }

    return {
      ok: true,
      action: result.action,
      workerName: result.workerName,
      shiftDate: result.shiftDate,
      startTime: result.startTime,
      gross: asNumber(result.gross),
      platformFee: asNumber(result.platformFee),
      charged: asNumber(result.charged),
      netPay: asNumber(result.netPay),
      balance: asNumber(result.balance),
      distanceM: typeof result.distanceM === 'number' ? result.distanceM : null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'QR 처리에 실패했어요.',
    };
  }
}
