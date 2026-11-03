// Minimal input tool for the iPhone Mirroring window: click / drag / type / key, coordinates in screen points.
import Foundation
import CoreGraphics
import Carbon.HIToolbox

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap); usleep(40_000) }
func move(_ p: CGPoint) { post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)) }
func click(_ p: CGPoint) {
    move(p); usleep(120_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left))
    usleep(80_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left))
}
func longPress(_ p: CGPoint, ms: UInt32) {
    move(p); usleep(120_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left))
    usleep(ms * 1000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left))
}
func drag(_ a: CGPoint, _ b: CGPoint, steps: Int = 24) {
    move(a); usleep(150_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
    usleep(150_000)
    for i in 1...steps {
        let t = CGFloat(i) / CGFloat(steps)
        let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        usleep(16_000)
    }
    usleep(120_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
}
func swipe(_ a: CGPoint, _ b: CGPoint) {
    move(a); usleep(200_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
    usleep(250_000)
    let steps = 40
    for i in 1...steps {
        let t = CGFloat(i) / CGFloat(steps)
        let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        usleep(22_000)
    }
    usleep(200_000)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
}
func tscroll(_ p: CGPoint, dy: Int32, steps: Int = 10) {
    let src = CGEventSource(stateID: .hidSystemState)
    move(p); usleep(150_000)
    func ev(_ d: Int32, phase: Int64, momentum: Int64 = 0) {
        let e = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: d, wheel2: 0, wheel3: 0)
        e?.location = p
        e?.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        e?.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        e?.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
        e?.setIntegerValueField(.scrollWheelEventPointDeltaAxis1, value: Int64(d))
        e?.setIntegerValueField(.scrollWheelEventFixedPtDeltaAxis1, value: Int64(d) << 16)
        e?.post(tap: .cgSessionEventTap); usleep(12_000)
    }
    ev(0, phase: 128)            // may begin
    ev(dy, phase: 1)             // began
    for _ in 0..<steps { ev(dy, phase: 2) }
    ev(0, phase: 4)              // ended
}
func scroll(_ p: CGPoint, dy: Int32) {
    move(p); usleep(100_000)
    let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)
    e?.location = p; post(e)
}
func typeText(_ s: String) {
    for ch in s.unicodeScalars {
        var u = [UniChar(ch.value)]
        let d = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true); d?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &u); post(d)
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false); up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &u); post(up)
        usleep(30_000)
    }
}
func key(_ code: CGKeyCode, cmd: Bool = false, mod: String = "") {
    // mod: "cmd" | "alt" | "shift" | "ctrl" — press the real modifier key first so iPhone Mirroring sees it
    let m = cmd ? "cmd" : mod
    let table: [String: (CGKeyCode, CGEventFlags)] = ["cmd": (55, .maskCommand), "alt": (58, .maskAlternate), "shift": (56, .maskShift), "ctrl": (59, .maskControl)]
    let modifier = table[m]
    if let (mk, mf) = modifier { let md = CGEvent(keyboardEventSource: nil, virtualKey: mk, keyDown: true); md?.flags = mf; post(md); usleep(60_000) }
    let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); if let (_, mf) = modifier { d?.flags = mf }; post(d)
    usleep(60_000)
    let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); if let (_, mf) = modifier { u?.flags = mf }; post(u)
    if let (mk, _) = modifier { usleep(60_000); let mu = CGEvent(keyboardEventSource: nil, virtualKey: mk, keyDown: false); mu?.flags = []; post(mu) }
}
let vk: [Character: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47," ":49]
func keys(_ s: String) {
    for ch in s {
        let upper = ch.isUppercase
        guard let code = vk[Character(ch.lowercased())] else { continue }
        if upper { let sd = CGEvent(keyboardEventSource: nil, virtualKey: 56, keyDown: true); sd?.flags = .maskShift; post(sd) }
        let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); if upper { d?.flags = .maskShift }; post(d)
        usleep(50_000)
        let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); if upper { u?.flags = .maskShift }; post(u)
        if upper { let su = CGEvent(keyboardEventSource: nil, virtualKey: 56, keyDown: false); su?.flags = []; post(su) }
        usleep(70_000)
    }
}
func windowID() -> (Int, CGRect)? {
    guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    for w in list {
        let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
        guard owner.contains("irroring") || owner.contains("미러링") else { continue }
        guard let n = w[kCGWindowNumber as String] as? Int, let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
        let f = { (k: String) -> Double in (b[k] as? NSNumber)?.doubleValue ?? 0 }
        let r = CGRect(x: f("X"), y: f("Y"), width: f("Width"), height: f("Height"))
        if r.width > 200 && r.width < 400 && r.height > 500 { return (n, r) }
    }
    return nil
}
let a = CommandLine.arguments
func pt(_ i: Int) -> CGPoint { CGPoint(x: Double(a[i])!, y: Double(a[i+1])!) }
switch a.count > 1 ? a[1] : "" {
case "click": click(pt(2))
case "press": longPress(pt(2), ms: UInt32(a[4])!)
case "drag": drag(pt(2), pt(4))
case "swipe": swipe(pt(2), pt(4))
case "tscroll": tscroll(pt(2), dy: Int32(a[4])!)
case "scroll": scroll(pt(2), dy: Int32(a[4])!)
case "move": move(pt(2))
case "wins":
    if let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for w in list { let o = (w[kCGWindowOwnerName as String] as? String) ?? ""; if o.contains("irror") || o.contains("미러") || o.contains("iPhone") { print(o, "|", (w[kCGWindowName as String] as? String) ?? "", "|", w[kCGWindowNumber as String] ?? 0, "|", w[kCGWindowBounds as String] ?? [:], "| layer", w[kCGWindowLayer as String] ?? 0, "| onscreen", w[kCGWindowIsOnscreen as String] ?? 0) } }
    }
case "winid": if let (n, r) = windowID() { print("\(n) \(Int(r.origin.x)) \(Int(r.origin.y)) \(Int(r.width)) \(Int(r.height))") } else { print("none"); exit(1) }
case "tap":  // tap by 2x screenshot pixel coords, resolved against the live window position
    guard let (_, r) = windowID() else { print("no window"); exit(1) }
    click(CGPoint(x: r.origin.x + Double(a[2])! / 2, y: r.origin.y + Double(a[3])! / 2))
case "tappress":
    guard let (_, r) = windowID() else { print("no window"); exit(1) }
    longPress(CGPoint(x: r.origin.x + Double(a[2])! / 2, y: r.origin.y + Double(a[3])! / 2), ms: UInt32(a[4])!)
case "type": typeText(a[2])
case "keys": keys(a[2])
case "caps": key(57)
case "key":
    let names: [String: CGKeyCode] = ["return": 36, "esc": 53, "tab": 48, "delete": 51, "space": 49, "home": 115, "up": 126, "down": 125, "left": 123, "right": 124, "h": 4, "v": 9, "c": 8, "a": 0]
    key(names[a[2]] ?? CGKeyCode(a[2])!, mod: a.count > 3 ? a[3] : "")
default: print("usage: mtool click X Y | press X Y MS | drag X1 Y1 X2 Y2 | scroll X Y DY | move X Y | type TEXT | key NAME [cmd]"); exit(2)
}
