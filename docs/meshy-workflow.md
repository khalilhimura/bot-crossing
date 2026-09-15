# Meshy to Nous Mission Control

Meshy can be an external asset creation tool for this world's asset registry.
The app imports GLBs regardless of which tool created them. It does not send
prompts, images, or credentials to Meshy.

## Inspected capabilities

The [Meshy MCP server](https://github.com/meshy-dev/meshy-mcp-server#readme)
exposes text/image generation, refinement, remeshing, retexturing, rigging,
animation, task status, balance checking and model download tools. Its
[download schema](https://github.com/meshy-dev/meshy-mcp-server/blob/56326ba165232de2ec136ab995be29e51b1ea343/src/schemas/tasks.ts)
defaults to GLB and accepts an absolute output path. Downloads normally go into
project folders beneath `meshy_output/` with task metadata.

Inspected on 2026-09-14 at upstream commit
`56326ba165232de2ec136ab995be29e51b1ea343`. No Meshy connection or paid generation
was run for this change. The upstream README describes API-key and plan
requirements; consult it for current access and credit costs.

## Suggested asset workflow

1. Create a prop from a prompt or reference image in your Meshy client. Describe
   its intended size, silhouette, colour palette and low-poly style.
2. Inspect the result before refining it. Use remesh if the geometry is too
   detailed for many instances; reduce texture resolution where possible.
3. Download the completed result as GLB with embedded textures. Keep the editable
   source or task metadata separately if you want to regenerate it later.
4. In Bot Crossing, open **Assets**, select **Import GLB**, and choose the file.
5. Orbit the preview and inspect the dimensions, triangle count and materials.
   Add the source or Meshy task reference, creator and applicable licence, then
   choose **Save import**.
6. Use **Place in world** to position it on the ground, or enter coordinates.
   Each instance has independent position, rotation, scale and animation.
7. Select an existing instance and **Swap model** to replace its model while
   preserving its transform. Adjust scale if the replacement has different
   source dimensions.

Generated humanoids can be previewed and placed with their own animation clips.
They do not automatically replace the colony astronaut: its rig, attachments,
behaviour mapping and shader need a separate compatibility step.

The server's software licence does not determine the licence of a generated
model. Record the rights applicable to your output; imported assets remain
unknown until you supply metadata. Keep API keys outside browser code and the
repository. This checkout ignores `meshy_output/` and local imported asset data.
