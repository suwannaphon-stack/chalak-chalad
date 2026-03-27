// netlify/functions/analyze.js
// Netlify Serverless Function — เรียก Google Gemini AI (ฟรี)
// ตั้ง Environment Variable: GEMINI_API_KEY ใน Netlify Dashboard

const PROMPT = `วิเคราะห์ฉลาก GDA (Guideline Daily Amount) ของไทยในภาพนี้ ตอบเป็น JSON เท่านั้น ห้ามมี markdown backticks หรือข้อความอื่นใด

ฉลาก GDA ของไทยตามประกาศ อย. จะแสดง 4 รายการ: พลังงาน (kcal), น้ำตาล (g), ไขมัน (g), โซเดียม (mg)
ค่าที่แสดงคือค่าต่อ 1 บรรจุภัณฑ์ทั้งหมด (ทั้งถุง/ทั้งซอง/ทั้งกล่อง)
ฉลากอาจระบุว่า "ควรแบ่งกิน X ครั้ง" ซึ่งหมายความว่า 1 หน่วยบริโภค = ค่าทั้งหมด ÷ X

หากภาพไม่ใช่ฉลาก GDA: {"error":"ไม่พบฉลาก GDA ในภาพ กรุณาถ่ายรูปฉลาก GDA (วงกลมสีบนซองอาหาร) ใหม่"}

หากเป็นฉลาก GDA ตอบ JSON:
{
  "product_name": "ชื่อผลิตภัณฑ์ (ถ้าอ่านได้)",
  "servings_per_package": 1,
  "per_package": {
    "label": "ทั้งห่อ/ทั้งซอง",
    "energy": {"value":0, "unit":"kcal", "gda_percent":0},
    "sugar": {"value":0, "unit":"g", "gda_percent":0},
    "fat": {"value":0, "unit":"g", "gda_percent":0},
    "sodium": {"value":0, "unit":"mg", "gda_percent":0},
    "traffic_light": {"energy":"green", "sugar":"green", "fat":"green", "sodium":"green"}
  },
  "per_serving": {
    "label": "ต่อ 1 หน่วยบริโภค",
    "energy": {"value":0, "unit":"kcal", "gda_percent":0},
    "sugar": {"value":0, "unit":"g", "gda_percent":0},
    "fat": {"value":0, "unit":"g", "gda_percent":0},
    "sodium": {"value":0, "unit":"mg", "gda_percent":0},
    "traffic_light": {"energy":"green", "sugar":"green", "fat":"green", "sodium":"green"}
  },
  "insight": "คำแนะนำสุขภาพ 2-3 ประโยค ภาษาไทยง่ายๆ ถ้าแบ่งกินได้หลายครั้งให้แนะนำว่าควรแบ่งกินด้วย"
}

กฎสำคัญ:
- per_package = ค่าที่อ่านจากฉลาก GDA โดยตรง (ค่าทั้งบรรจุภัณฑ์)
- servings_per_package = จำนวนครั้งที่แนะนำให้แบ่งกิน (ถ้าฉลากไม่ระบุ ให้ใส่ 1)
- per_serving = per_package ÷ servings_per_package (ปัดเป็นจำนวนเต็ม)
- ถ้า servings_per_package = 1 ให้ per_serving มีค่าเท่ากับ per_package
- gda_percent คำนวณจากค่าแนะนำต่อวัน (ปัดเป็นจำนวนเต็ม)
- label ของ per_package ให้ระบุชื่อบรรจุภัณฑ์ เช่น "ทั้งถุง", "ทั้งซอง", "ทั้งกล่อง"

ค่าแนะนำต่อวัน (Thai FDA GDA สำหรับผู้ใหญ่):
- พลังงาน: 2000 kcal
- น้ำตาล: 65 g
- ไขมัน: 65 g
- โซเดียม: 2000 mg

traffic_light: green (≤10%), amber (11-25%), red (>25%) — คำนวณแยกสำหรับ per_package และ per_serving

อ่านค่าจากฉลากในภาพให้ถูกต้องตามตัวเลขที่เห็นจริงเท่านั้น ห้ามเดา`;

export default async (request, context) => {
  // CORS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { image_base64, media_type } = body;

    if (!image_base64) {
      return Response.json({ error: "กรุณาส่งรูปภาพ" }, { status: 400 });
    }

    if (image_base64.length > 10 * 1024 * 1024) {
      return Response.json({ error: "รูปใหญ่เกินไป" }, { status: 400 });
    }

    const mt = ["image/jpeg","image/png","image/gif","image/webp"].includes(media_type) ? media_type : "image/jpeg";

    // Call Gemini 2.5 Flash
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mt, data: image_base64 } },
            { text: PROMPT }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini error:", JSON.stringify(data.error));
      return Response.json({ error: "AI เกิดข้อผิดพลาด: " + (data.error.message || JSON.stringify(data.error)) }, { status: 502 });
    }

    if (!data.candidates || !data.candidates[0]) {
      console.error("No candidates:", JSON.stringify(data));
      return Response.json({ error: "AI ไม่ตอบกลับ อาจถูกบล็อก ลองรูปอื่น" }, { status: 502 });
    }

    const text = data.candidates[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    if (!clean) {
      console.error("Empty response text. Full data:", JSON.stringify(data).substring(0, 500));
      return Response.json({ error: "AI ตอบกลับว่างเปล่า ลองถ่ายรูปใหม่" }, { status: 502 });
    }

    try {
      // Try to extract JSON from response even if there's extra text
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : clean;
      const parsed = JSON.parse(jsonStr);
      return Response.json(parsed);
    } catch (e) {
      console.error("Parse error:", e.message, "Raw text:", clean.substring(0, 300));
      return Response.json({ error: "AI อ่านฉลากไม่ได้ ลองถ่ายรูปใหม่ให้ชัดขึ้น (debug: " + clean.substring(0, 100) + ")" }, { status: 502 });
    }

  } catch (err) {
    console.error("Server error:", err);
    return Response.json({ error: "เกิดข้อผิดพลาด กรุณาลองใหม่" }, { status: 500 });
  }
};
