import { NextResponse } from 'next/server';

// Reached only when no service worker intercepted the share (first visit, or a browser without share-target support).
// Nothing is stored server-side; the page explains that sharing works from the installed app.
export async function POST(request: Request) {
  return NextResponse.redirect(new URL('/?shared=unsupported', request.url), 303);
}
export async function GET(request: Request) {
  return NextResponse.redirect(new URL('/', request.url), 303);
}
