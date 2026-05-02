"""
workday_agent.py — Starter rapplication: WORK-type daybrief organism.

Personality: a focused operator. Helps you plan the day, summarize what
happened, prep for the next meeting. Stateless per call but honest about
what it can't see (no calendar/email integration baked in — those are
ENV-gated extensions you can add later).

Catalog tier: starter rapplication. Ships from rapp-zoo as a 2.2-rapplication
egg. Hatches into any brainstem; identifies as @rapp/workday in the host's
rapp registry.
"""

from agents.basic_agent import BasicAgent


__manifest__ = {
    "schema": "rapp-agent/1.0",
    "name": "@rapp/workday",
    "version": "0.1.0",
    "display_name": "Workday",
    "description": "Daybrief operator. Ask it to plan, recap, or prep — it'll respond in tight bullets.",
    "author": "RAPP",
    "tags": ["starter", "work", "productivity", "daybrief"],
    "category": "work",
    "quality_tier": "starter",
    "requires_env": [],
    "example_call": "Plan my day. I have a 9am standup, a 1:1 with my manager at 11, and a deep-work block in the afternoon.",
}


class WorkdayAgent(BasicAgent):
    """Tight, opinionated daybrief assistant."""

    metadata = {
        "name": "workday",
        "description": (
            "Plan, recap, or prep for the workday. Use when the user wants a "
            "structured rundown of their day, a meeting prep brief, or an "
            "after-hours wrap-up. Returns terse bullets, not paragraphs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "request": {
                    "type": "string",
                    "description": (
                        "What the user wants — e.g. 'plan my day', "
                        "'recap what happened', 'prep me for the 2pm with finance'"
                    ),
                },
                "context": {
                    "type": "string",
                    "description": (
                        "Optional context: meetings, tasks, notes the user "
                        "wants the daybrief to incorporate"
                    ),
                },
            },
            "required": ["request"],
        },
    }

    def perform(self, request="", context="", **kwargs):
        if not request:
            return "Tell me what you want — plan / recap / prep / wrap-up."

        # The LLM does the actual reasoning; this agent's value is its
        # opinionated personality (tight bullets, no preamble) which the
        # host brainstem's chat loop carries via the agent's description.
        framing = []
        framing.append(f"Daybrief request: {request}")
        if context:
            framing.append(f"Context: {context}")
        framing.append(
            "Respond with: 3-7 bullets max, each starting with a verb. "
            "No preamble, no 'I will'. Mark anything you can't verify with "
            "(unverified)."
        )
        return "\n\n".join(framing)
