// Genera scripts/boe/temario-prl.json: mapa epígrafe del temario específic → normas y preceptos que lo desarrollan.
// Uso: node scripts/boe/prl-gen.mjs && node scripts/boe/build.mjs scripts/boe/temario-prl.json
import { writeFileSync } from 'node:fs';

const N = {
  L: ['BOE-A-1995-24292', 'Ley 31-1995 PRL', 'Ley 31/1995, de 8 de noviembre, de Prevención de Riesgos Laborales'],
  R39: ['BOE-A-1997-1853', 'RD 39-1997 Servicios de prevencion', 'Real Decreto 39/1997, de 17 de enero, por el que se aprueba el Reglamento de los Servicios de Prevención'],
  GSS: ['BOE-A-2015-11724', 'RDL 8-2015 LGSS', 'Real Decreto Legislativo 8/2015, de 30 de octubre, texto refundido de la Ley General de la Seguridad Social'],
  OTAS: ['BOE-A-2002-22650', 'Orden TAS-2926-2002', 'Orden TAS/2926/2002, de 19 de noviembre, nuevos modelos para la notificación de los accidentes de trabajo'],
  R513: ['BOE-A-2017-6606', 'RD 513-2017 RIPCI', 'Real Decreto 513/2017, de 22 de mayo, Reglamento de instalaciones de protección contra incendios'],
  R393: ['BOE-A-2007-6237', 'RD 393-2007 Autoproteccion', 'Real Decreto 393/2007, de 23 de marzo, Norma Básica de Autoprotección'],
  R171: ['BOE-A-2004-1848', 'RD 171-2004 Coordinacion', 'Real Decreto 171/2004, de 30 de enero, coordinación de actividades empresariales'],
  R486: ['BOE-A-1997-8669', 'RD 486-1997 Lugares de trabajo', 'Real Decreto 486/1997, de 14 de abril, disposiciones mínimas de seguridad y salud en los lugares de trabajo'],
  R485: ['BOE-A-1997-8668', 'RD 485-1997 Senalizacion', 'Real Decreto 485/1997, de 14 de abril, señalización de seguridad y salud en el trabajo'],
  R1215: ['BOE-A-1997-17824', 'RD 1215-1997 Equipos de trabajo', 'Real Decreto 1215/1997, de 18 de julio, utilización de los equipos de trabajo'],
  R773: ['BOE-A-1997-12735', 'RD 773-1997 EPI', 'Real Decreto 773/1997, de 30 de mayo, utilización de equipos de protección individual'],
  R614: ['BOE-A-2001-11881', 'RD 614-2001 Riesgo electrico', 'Real Decreto 614/2001, de 8 de junio, protección frente al riesgo eléctrico'],
  R374: ['BOE-A-2001-8436', 'RD 374-2001 Agentes quimicos', 'Real Decreto 374/2001, de 6 de abril, riesgos relacionados con los agentes químicos'],
  R286: ['BOE-A-2006-4414', 'RD 286-2006 Ruido', 'Real Decreto 286/2006, de 10 de marzo, exposición al ruido'],
  R664: ['BOE-A-1997-11144', 'RD 664-1997 Agentes biologicos', 'Real Decreto 664/1997, de 12 de mayo, exposición a agentes biológicos'],
  R487: ['BOE-A-1997-8670', 'RD 487-1997 Manipulacion de cargas', 'Real Decreto 487/1997, de 14 de abril, manipulación manual de cargas'],
  R488: ['BOE-A-1997-8671', 'RD 488-1997 Pantallas', 'Real Decreto 488/1997, de 14 de abril, equipos con pantallas de visualización'],
  LO3: ['BOE-A-2007-6115', 'LO 3-2007 Igualdad', 'Ley Orgánica 3/2007, de 22 de marzo, para la igualdad efectiva de mujeres y hombres'],
};
const P = (k, arts, anexos) => ({
  id: N[k][0], file: `${N[k][1]}.md`, title: N[k][2],
  select: [{ ...(arts && { arts }), ...(anexos && { anexos }) }],
});
const T = [
  ['Règim jurídic de la prevenció de riscos laborals', [P('L', '1-4,14,29')]],
  ['Organització de la prevenció', [P('L', '30,31'), P('R39', '10-15')]],
  ['Informació, consulta, participació i representació', [P('L', '33-37')], 'Registre de delegats de prevenció: normativa autonòmica (no BOE)'],
  ['Comitè de seguretat i salut', [P('L', '38,39')]],
  ['El Pla de prevenció de riscos laborals', [P('L', '16'), P('R39', '1,2')]],
  ['Avaluació de riscos i planificació', [P('R39', '3-7')]],
  ['Seguiment de la planificació de l’activitat preventiva', [P('R39', '8,9')], 'Inspeccions de seguretat i controls d’activitats: sense regulació específica'],
  ['Formació i informació en matèria de prevenció', [P('L', '18,19')]],
  ['Accidents de treball. Concepte i marc normatiu', [P('GSS', '156')], 'Procediment d’assistència sanitària: protocol intern (no BOE)'],
  ['Accidents de treball. Tramitació, notificació i investigació', [P('OTAS', '1-4')]],
  ['Vigilància de la salut', [P('L', '22'), P('R39', '37')]],
  ['Protecció dels empleats especialment sensibles', [P('L', '25')]],
  ['Protecció de la maternitat i la lactància natural', [P('L', '26'), P('GSS', '186-189')]],
  ['Documentació preventiva', [P('L', '23')]],
  ['Prevenció i actuació en incendis', [P('R513', '1-3')]],
  ['Actuacions en cas d’emergència', [P('L', '20'), P('R393', '1-3')]],
  ['Coordinació d’activitats empresarials', [P('L', '24'), P('R171', '1-12')]],
  ['La figura del recurs preventiu', [P('L', '32 bis'), P('R39', '22 bis')]],
  ['Condicions generals de seguretat i salut en els llocs de treball', [P('R486', '1,2', 'I,II,III,IV,V,VI')]],
  ['Senyalització de seguretat i salut en el treball', [P('R485', '1-6')]],
  ['Equips de treball', [P('R1215', '1-5')], 'Eines manuals: sense regulació específica'],
  ['Protecció individual i col·lectiva. Equips de protecció individual', [P('L', '15,17'), P('R773', '1-9')]],
  ['Risc elèctric', [P('R614', '1-4')]],
  ['Higiene industrial', [P('R374', '1,2')], 'Concepte i classificació de riscos higiènics: doctrina tècnica, no normativa'],
  ['Contaminants químics. Fitxa de dades de seguretat', [P('R374', '3-5,9')], 'Fitxa de dades de seguretat: Reglament (CE) 1907/2006 REACH (no BOE)'],
  ['Exposició al soroll', [P('R286', '1-5')]],
  ['Agents biològics', [P('R664', '1-4')]],
  ['Ergonomia', [], 'Conceptes i objectius: doctrina tècnica, no normativa'],
  ['Manipulació manual de càrregues, moviments repetitius i postures forçades', [P('R487', '1-4')], 'Moviments repetitius i postures forçades: doctrina tècnica'],
  ['Pantalles de visualització de dades', [P('R488', '1-4', 'unico')]],
  ['Factors de risc psicosocial', [], 'Concepte: doctrina tècnica, no normativa'],
  ['Violència laboral i assetjament', [P('LO3', '7')], 'Assetjament laboral i discriminatori: protocols (no BOE); també als apunts del temari general'],
];
const normas = T.map(([t, parts, nota], i) => ({ tema: `Tema ${String(i + 1).padStart(2, '0')}. ${t}`, parts, ...(nota && { nota }) }));
writeFileSync(new URL('./temario-prl.json', import.meta.url), JSON.stringify({
  out: 'public/temario/Ayuntamiento de Tarragona/Temari específic', inventario: 'inventario-prl.md', normas,
}, null, 1));
