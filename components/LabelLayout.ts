import {createContext,type MutableRefObject} from "react";
import type {LabelBox} from "@/lib/label-layout";
export type {LabelBox} from "@/lib/label-layout";
export const LabelLayout=createContext<MutableRefObject<LabelBox[]>|null>(null);
