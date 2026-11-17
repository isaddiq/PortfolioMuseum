// What each research demonstration shows: title, stages (with the time each
// starts, in seconds), a description for the panel, and links to the
// portfolio items it relates to. The builders live in demos-a.js,
// demos-b.js and demos-c.js (the lobby's centrepiece).
//
// Wording rule: these describe methods. They never state results, figures or
// findings; the models are conceptual simulations.

import { buildBIM, buildInformatics, buildXR, buildRobot, buildDfMA } from './demos-a.js';
import { buildAI, buildTwin, buildInterop, buildNav } from './demos-b.js';
import { buildEcosystem } from './demos-c.js';

export const DEMOS = {
    bim: {
        key: 'bim', title: 'BIM: a building assembled from information', short: 'Building Information Modeling',
        icon: 'fas fa-cube', accent: '#2f6fd6', build: buildBIM, duration: 27, rest: 20,
        stages: [
            { at: 0, label: 'Foundations', caption: 'Pad footings emerge, then the ground-bearing slab is placed.' },
            { at: 3.2, label: 'Columns & slabs', caption: 'The frame rises storey by storey; each slab lands once its columns are up.' },
            { at: 12.4, label: 'Envelope', caption: 'Walls and curtain walls close the building, level by level.' },
            { at: 16.5, label: 'Semantic model', caption: 'Elements take their IFC class colours. Click any element to read its properties.' }
        ],
        description: 'In Building Information Modeling a building is described as typed, related elements rather than lines on a drawing. This miniature assembles a three-storey frame in construction order, and every element carries IFC-style semantics: its class, level, material, dimensions and property set. Select an element to inspect it.',
        related: { topics: ['BIM & Interoperability'], tools: ['ifcexplorer', 'reunixchange'], projects: ['project_003'] }
    },
    informatics: {
        key: 'informatics', title: 'Construction informatics: data-driven site decisions', short: 'Construction Informatics',
        icon: 'fas fa-chart-column', accent: '#0e8fae', build: buildInformatics, duration: 26, rest: 24,
        stages: [
            { at: 0, label: 'Capture', caption: 'Deliveries, crane lifts and progress are logged as they happen on site.' },
            { at: 6, label: 'Exchange', caption: 'Each record travels to a shared project data environment.' },
            { at: 12, label: 'Monitor', caption: 'Planned and actual progress are compared; a late delivery opens a gap.' },
            { at: 16.5, label: 'Decide', caption: 'The lift sequence is re-prioritised and progress returns to the plan.' }
        ],
        description: 'Construction informatics turns site activity into structured project data that supports decisions. Here a truck, a tower crane and a building under construction report what they do; the dashboard compares planned against actual progress, flags a deviation caused by a late delivery, and shows the effect of re-sequencing the lifts.',
        related: { topics: ['4D Simulation & Digital Twins'], projects: ['project_004'], tools: ['bim-vr-4d-simulation'] }
    },
    xr: {
        key: 'xr', title: 'Extended reality: from a physical model to a hologram', short: 'Extended Reality (XR)',
        icon: 'fas fa-vr-cardboard', accent: '#7c4fd6', build: buildXR, duration: 22, rest: 13,
        stages: [
            { at: 0, label: 'Physical model', caption: 'A physical scale model of the building stands on the plinth.' },
            { at: 2.5, label: 'Scan & register', caption: 'A registration plane sweeps upward, aligning the digital model with the physical one.' },
            { at: 8.5, label: 'Holographic model', caption: 'The building is now a holographic BIM representation, viewed through a headset.' },
            { at: 11, label: 'Spatial overlays', caption: 'Information is anchored in place; what the headset looks at is highlighted.' },
            { at: 17.5, label: 'Back to physical', caption: 'The overlay is withdrawn and the physical model returns.' }
        ],
        description: 'Extended reality places building information in the space where people work. The miniature shows the idea behind BIM-to-XR exchange: a physical model is registered with its digital counterpart, becomes a holographic model, and carries spatial annotations that a headset user can look at and query.',
        related: { topics: ['XR & Game Engines'], tools: ['bim-vr-4d-simulation', 'bim-mr-modular-construction', 'reunixchange'] }
    },
    robot: {
        key: 'robot', title: 'Construction robotics: planned pick-and-place', short: 'Construction Robotics',
        icon: 'fas fa-robot', accent: '#14946b', build: buildRobot, duration: 47, rest: 40,
        period: 7.2, count: 6, unit: 'Brick',
        stages: [
            { at: 0, label: 'Plan trajectory', caption: 'The tool path for the next brick is planned and drawn before the arm moves.' },
            { at: 0.9, label: 'Approach & grasp', caption: 'The arm descends over the pallet and closes the gripper on a brick.' },
            { at: 3.0, label: 'Transfer', caption: 'The brick is lifted and carried along the planned arc, clear of the base.' },
            { at: 5.4, label: 'Place & release', caption: 'The brick is set in the wall course, released, and the arm retracts.' }
        ],
        description: 'A six-joint arm lays a short brick wall. Each move is planned first (the dotted tool path), then executed with smooth, minimum-jerk motion: the joints are solved by inverse kinematics from the planned tool position, so they move together rather than one at a time. It illustrates linking a building model to robotic assembly tasks.',
        related: { projects: ['project_001'], tools: ['bim2bot-lab'], interests: ['Construction Robotics'] }
    },
    dfma: {
        key: 'dfma', title: 'DfMA: manufactured, lifted and assembled', short: 'Design for Manufacturing and Assembly',
        icon: 'fas fa-industry', accent: '#e0631f', build: buildDfMA, duration: 44, rest: 40,
        period: 6.4, count: 6, unit: 'Module',
        stages: [
            { at: 0, label: 'Manufacture', caption: 'On the factory bed, the floor, walls and roof panels form a volumetric module.' },
            { at: 2.1, label: 'Lift', caption: 'The gantry hoist picks the finished module.' },
            { at: 3.2, label: 'Transport', caption: 'The module travels to site; it sways and settles as the trolley stops.' },
            { at: 4.6, label: 'Assemble', caption: 'It is lowered onto its position in the stack, bottom row first.' }
        ],
        description: 'Design for Manufacturing and Assembly moves work from the site to the factory. In this sequence each volumetric module is made from panels on a production bed, then lifted, transported and stacked in a logical order until a three-storey modular building stands.',
        related: { topics: ['Modular & DfMA'], tools: ['bim-mr-modular-construction'] }
    },
    ai: {
        key: 'ai', title: 'AI for construction: asking the building model', short: 'AI for Construction',
        icon: 'fas fa-brain', accent: '#0f9b8e', build: buildAI, duration: 27, rest: 7.5,
        period: 9, count: 3, unit: 'Query',
        stages: [
            { at: 0, label: 'Ask', caption: 'A question about the building is typed in plain language.' },
            { at: 2.6, label: 'Interpret', caption: 'The question is mapped to IFC classes, a level and the relevant properties.' },
            { at: 4.0, label: 'Retrieve', caption: 'Candidate elements of that class are found in the model.' },
            { at: 5.2, label: 'Answer', caption: 'Matching elements are highlighted and the answer is returned.' }
        ],
        description: 'Language interfaces let people query building data without knowing its schema. The terminal shows three example questions; each is interpreted into IFC classes and properties, the matching elements are retrieved from the model and highlighted, and an answer is given. The questions and answers are illustrative.',
        related: { topics: ['AI & NLP'], projects: ['project_002'], tools: ['ai-chatbot'] }
    },
    twin: {
        key: 'twin', title: 'Digital twin: a building and its live model', short: 'Digital Twin',
        icon: 'fas fa-clone', accent: '#d48a17', build: buildTwin, duration: 30, rest: 17,
        stages: [
            { at: 0, label: 'Sense', caption: 'Morning: occupancy, temperature and CO₂ sensors report from every room.' },
            { at: 6, label: 'Synchronise', caption: 'The digital model mirrors each room: lights, people and air quality.' },
            { at: 13, label: 'Analyse', caption: 'After lunch the meeting room’s CO₂ climbs; the twin flags it.' },
            { at: 19, label: 'Act', caption: 'The twin boosts ventilation; CO₂ falls. In the evening the rooms empty.' }
        ],
        description: 'A digital twin is a model kept in step with a real building. Over one simulated working day the miniature building’s rooms fill and empty, its lights and ventilation change, and the twin beside it mirrors every room, colours it by air quality, and sends a ventilation command back when a room needs it. All values are simulated.',
        related: { topics: ['4D Simulation & Digital Twins'], projects: ['project_001'] }
    },
    interop: {
        key: 'interop', title: 'BIM interoperability: IFC to an engine-ready scene', short: 'BIM Data Interoperability',
        icon: 'fas fa-exchange-alt', accent: '#c73f86', build: buildInterop, duration: 26, rest: 19,
        stages: [
            { at: 0, label: 'IFC model', caption: 'The source model: typed IFC entities with properties and levels.' },
            { at: 3, label: 'Map & tessellate', caption: 'Each element passes through the mapping: geometry becomes triangles, its class and properties travel with it.' },
            { at: 12, label: 'Engine-ready scene', caption: 'Colliders and a walkable navigation mesh are generated for games and robots.' },
            { at: 17, label: 'Semantics preserved', caption: 'Element by element, class, identity and properties are checked on both sides.' }
        ],
        description: 'Moving BIM into game engines and robotics platforms usually loses meaning. This sequence shows the principle of a semantic mapping: each IFC element is tessellated for the engine while keeping its class, identity and properties, and the receiving scene gains colliders and a navigation mesh that robots and simulations can use.',
        related: { topics: ['BIM & Interoperability'], tools: ['bimunixchange', 'ifc2unity', 'ifcusd', 'reunixchange'] }
    },
    nav: {
        key: 'nav', title: 'Robot navigation from a building model', short: 'Robotic Navigation & Simulation',
        icon: 'fas fa-route', accent: '#2b8a4a', build: buildNav, duration: 30, rest: 14,
        stages: [
            { at: 0, label: 'Map from BIM', caption: 'Walls from the floor plan become an occupancy grid for the robot.' },
            { at: 2.5, label: 'Plan route', caption: 'A* searches the grid (the explored cells light up) and finds a route.' },
            { at: 4.6, label: 'Follow route', caption: 'The robot follows the calculated path, scanning ahead.' },
            { at: 9, label: 'Detect & replan', caption: 'A person blocks the doorway; the robot stops and plans another way.' },
            { at: 20, label: 'Arrive', caption: 'The robot reaches its goal by the new route.' }
        ],
        description: 'Building models can tell a mobile robot where it may go. The plan is converted to an occupancy grid, a route is found with A* search, and the robot follows it while its scanner watches ahead. When a person steps into a doorway on its route, it stops, marks the cells as blocked and replans. The route and the replanning are computed live in your browser.',
        related: { projects: ['project_001'], tools: ['bim2bot-lab'], interests: ['Construction Robotics'] }
    },
    ecosystem: {
        key: 'ecosystem', title: 'One model, four ways of working with it', short: 'BIM · Robotics · XR · Digital Twin',
        icon: 'fas fa-diagram-project', accent: '#b08d57', build: buildEcosystem, duration: 24, rest: 3,
        bounds: [2.2, 1.0, 2.2], boundsZ: 0,
        stages: [
            { at: 0, label: 'BIM', caption: 'The building model: elements, levels and their information.' },
            { at: 6, label: 'Robotics', caption: 'A robot navigates around the building using the model.' },
            { at: 12, label: 'XR', caption: 'The model is viewed as a hologram for immersive review.' },
            { at: 18, label: 'Digital twin', caption: 'Live data flows between the building and its model, and back to BIM.' }
        ],
        description: 'The research in this museum shares one idea: a semantically rich building model at the centre, connected to robots, immersive interfaces and live operational data. This centrepiece cycles through those connections. The galleries hold a demonstration of each: Gallery IV (Projects) for BIM, robotics, DfMA, informatics and AI; Gallery VI (Tools) for interoperability, robot navigation, XR and digital twins.',
        related: { interests: ['Building Information Modeling (BIM)', 'Construction Robotics', 'Extended Reality (XR)', 'Digital Twin'] }
    }
};

/** Which demonstration illustrates each research interest (by title). */
export const INTEREST_DEMOS = {
    'Building Information Modeling (BIM)': 'bim',
    'Construction Informatics': 'informatics',
    'Extended Reality (XR)': 'xr',
    'Construction Robotics': 'robot',
    'Design for Manufacturing and Assembly (DfMA)': 'dfma',
    'AI for Construction': 'ai',
    'Digital Twin': 'twin',
    'BIM Data Interoperability': 'interop'
};
