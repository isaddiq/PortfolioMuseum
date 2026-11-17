// Room culling: only what can be seen is drawn.
//
// The building is a set of rooms joined by openings (the lobby and the
// contact room open onto the Grand Hall; so does every gallery, through its
// door). The frustum alone cannot tell that a gallery lies behind a wall, so
// without this every work in the building is drawn from the lobby: three
// times over, counting the mirrored floor and the shadow pass.
//
// Each room's contents live in their own group, every top-level piece in a
// cell with a footprint (a circle on the plan). The room the visitor stands
// in is drawn whole. Any other room is seen through one or two openings, and
// a cell there is drawn only if it lies inside the wedge from the eye through
// each of them.

import * as THREE from 'three';
import { ROOMS, ROOM_BY_ID, roomAt } from './world.js';

const MARGIN = 0.6;          // metres added to every footprint (shadows, glows)
const NEAR_PORTAL = 0.9;     // this close to an opening, it hides nothing
const WIDE = 9;              // a footprint this large spans its room

/** The opening that joins a room to the hall, as a segment on the plan. */
function portalOf(room) {
    const o = room.openings?.[0];
    if (!o || room.id === 'hall') return null;
    const [x1, z1, x2, z2] = room.rect;
    if (o.side === 'E') return { ax: x2, az: o.from, bx: x2, bz: o.to };
    if (o.side === 'W') return { ax: x1, az: o.from, bx: x1, bz: o.to };
    if (o.side === 'S') return { ax: o.from, az: z2, bx: o.to, bz: z2 };
    return { ax: o.from, az: z1, bx: o.to, bz: z1 };
}

function distToSegment(px, pz, s) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - s.ax - dx * t, pz - s.az - dz * t);
}

export function createRoomCulling(museum) {
    const rooms = new Map();
    const box = new THREE.Box3();
    for (const room of ROOMS) {
        const group = museum.rooms[room.id];
        if (!group) continue;
        group.updateMatrixWorld(true);
        const cells = [];
        for (const child of [...group.children]) {
            box.setFromObject(child);
            // Wrapped, so this never fights with a piece's own visibility.
            const cell = new THREE.Group();
            cell.matrixAutoUpdate = false;
            group.add(cell);
            cell.add(child);
            if (box.isEmpty()) continue;
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            cells.push({ cell, x: cx, z: cz, r: Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + MARGIN });
        }
        rooms.set(room.id, { room, group, cells, portal: portalOf(room), mode: '' });
    }

    let current = ROOM_BY_ID.home;
    const wedges = [];
    let stamp = '';
    const eye = { x: 0, z: 0 };
    const probe = { x: 0, z: 0, r: 0 };

    /** The wedge from the eye through an opening, or null when it hides nothing. */
    function wedge(x, z, s) {
        if (distToSegment(x, z, s) < NEAR_PORTAL) return null;
        let ax = s.ax - x;
        let az = s.az - z;
        let bx = s.bx - x;
        let bz = s.bz - z;
        if (ax * bz - az * bx < 0) [ax, az, bx, bz] = [bx, bz, ax, az];
        return { ax, az, bx, bz, la: Math.hypot(ax, az), lb: Math.hypot(bx, bz) };
    }

    function inside(c, x, z, list) {
        const px = c.x - x;
        const pz = c.z - z;
        for (const w of list) {
            if (w.ax * pz - w.az * px < -c.r * w.la) return false;
            if (px * w.bz - pz * w.bx < -c.r * w.lb) return false;
        }
        return true;
    }

    function show(entry, x, z, list) {
        entry.wedges = list.slice();
        if (!list.length) {
            entry.group.visible = true;
            for (const c of entry.cells) c.cell.visible = true;
            return;
        }
        // Pieces that span the room (its picture lights, one instanced mesh)
        // are drawn only if something else in the room is.
        let any = false;
        for (const c of entry.cells) {
            if (c.r > WIDE) continue;
            c.cell.visible = inside(c, x, z, list);
            any = any || c.cell.visible;
        }
        for (const c of entry.cells) if (c.r > WIDE) c.cell.visible = any;
        entry.group.visible = any;
    }

    return {
        rooms,
        /** Set what is drawn for an eye at (x, z). True when anything may have changed. */
        update(x, z) {
            const key = `${x.toFixed(2)},${z.toFixed(2)}`;
            if (key === stamp) return false;
            stamp = key;
            eye.x = x;
            eye.z = z;
            current = roomAt(x, z) || current;
            const here = rooms.get(current.id);
            const hall = rooms.get('hall');
            for (const entry of rooms.values()) {
                wedges.length = 0;
                if (entry === here) { show(entry, x, z, wedges); continue; }
                // The way out of this room, then the way into that one.
                if (here?.portal) {
                    const w = wedge(x, z, here.portal);
                    if (w) wedges.push(w);
                }
                if (entry !== hall && entry.portal) {
                    const w = wedge(x, z, entry.portal);
                    if (w) wedges.push(w);
                }
                show(entry, x, z, wedges);
            }
            return true;
        },
        /**
         * Could something of radius r standing at (x, z) be seen from where
         * the eye is? For things that move about: people and robots.
         */
        sees(x, z, r = 0.5) {
            const entry = rooms.get(roomAt(x, z)?.id);
            if (!entry || !entry.wedges || !entry.wedges.length) return true;
            probe.x = x;
            probe.z = z;
            probe.r = r + MARGIN;
            return inside(probe, eye.x, eye.z, entry.wedges);
        },
        /** Is this object in a part of the building that is being drawn? */
        drawn(object) {
            for (let o = object; o; o = o.parent) if (!o.visible) return false;
            return true;
        },
        /** Everything on (for a capture or a debug view). */
        showAll() {
            stamp = '';
            for (const entry of rooms.values()) {
                entry.group.visible = true;
                entry.wedges = [];
                for (const c of entry.cells) c.cell.visible = true;
            }
        }
    };
}
