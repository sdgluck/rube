/**
 * An integer, for the native models — `Int64` in Swift and `Long` in Kotlin
 * rather than a `Double` every screen has to round.
 *
 * Deliberately not `z.number().int()`. These schemas are the server's
 * `.output()`, so a validating int would turn one fractional value in some
 * library into a 500 for the web UI as well. As an annotation, a wrong guess
 * costs one native decode, which the app reports.
 */
import { z } from "zod";

export const int = () => z.number().meta({ format: "int64" });
