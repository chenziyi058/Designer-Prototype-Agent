import { defineEventHandler } from "nitro/h3";
import { handleApi } from "../../../../server/api";
import { getVercelRuntime } from "../../../../server/runtime/vercel";

export default defineEventHandler(async (event) => {
  const response = await handleApi(event.req, getVercelRuntime());
  return (
    response ||
    new Response(JSON.stringify({ detail: "接口不存在" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  );
});
