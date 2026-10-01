"use client";

// One submit pattern for the recording forms (PRD: Form dan action behavior):
// validate locally, post once (useMutation keeps the idempotency key), ask the
// cutover-day question when the server needs it, then show the acknowledged
// outcome. `onReset` clears the caller's fields for `Catat lagi`.
import { AnimatePresence, m } from "motion/react";
import { useState, type ReactNode } from "react";

import { CutoverDayQuestion, FormErrors, SubmitBar, SubmitButton } from "@/components/form";
import { useSlide } from "@/components/motion";
import { Recorded, type PostResult } from "@/components/recorded";
import { useMutation } from "@/lib/api-client";

export function RecordingForm(props: {
  path: string;
  submitLabel: string;
  validate: () => string[];
  body: () => Record<string, unknown>;
  onReset: () => void;
  children: ReactNode;
}) {
  const save = useMutation<Record<string, unknown>, PostResult>(props.path);
  const [done, setDone] = useState<PostResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const rise = useSlide(8);

  async function submit(cutoverDayAnswer?: "ALREADY_IN_OPENING" | "NOT_IN_OPENING") {
    const issues = props.validate();
    if (issues.length) {
      save.setError(issues);
      return;
    }
    const result = await save.submit({ ...props.body(), ...(cutoverDayAnswer ? { cutoverDayAnswer } : {}) });
    if (result.ok) setDone(result.data);
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <m.div key="done" initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <Recorded
            result={done}
            onAgain={() => {
              setDone(null);
              props.onReset();
              setFormKey((key) => key + 1);
            }}
          />
        </m.div>
      ) : (
        <m.form
          key={`form-${formKey}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="max-w-xl space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await submit();
          }}
        >
          {props.children}
          {save.needsCutoverAnswer ? <CutoverDayQuestion pending={save.pending} onAnswer={(answer) => submit(answer)} /> : null}
          <FormErrors errors={save.error} />
          <SubmitBar>
            <SubmitButton pending={save.pending}>{props.submitLabel}</SubmitButton>
          </SubmitBar>
        </m.form>
      )}
    </AnimatePresence>
  );
}
