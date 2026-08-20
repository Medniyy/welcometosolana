import { Buffer } from "buffer";
import "./widget.css";

globalThis.Buffer = Buffer;
globalThis.global = globalThis;

import("./app.jsx");
