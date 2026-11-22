import { common } from "./common";
import { analysis } from "./analysis";
import { app } from "./app";
import { brain } from "./brain";
import { dosimetry } from "./dosimetry";
import { edit } from "./edit";
import { io } from "./io";
import { kinetics } from "./kinetics";
import { registration } from "./registration";
import { segmentation } from "./segmentation";
import { ui } from "./ui";
import { viewer } from "./viewer";

/** German source text → English. One file per area; merged here. */
export const EN_PARTS: Record<string, string>[] = [common, analysis, app, brain, dosimetry, edit, io, kinetics, registration, segmentation, ui, viewer];
