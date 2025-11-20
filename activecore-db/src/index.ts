import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, initializeDatabase } from './config/db.config';
import axios from 'axios';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
// Avoid startup crash if OPENAI_API_KEY missing
let openai: OpenAI | undefined;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('✅ OpenAI initialized');
} else {
  openai = undefined;
  console.log('⚠️ OPENAI_API_KEY not present — OpenAI features disabled');
}
import nodemailer, { Transporter } from 'nodemailer';
import crypto from 'crypto';

const app = express();

// Track OpenAI availability globally
let openaiAvailable = true;

// Dev CORS: allow all in development for quick debugging
app.use(cors({ origin: true, credentials: true }));
app.options('*', cors({ origin: true, credentials: true }));

app.use(express.json());

// Debug: log incoming requests and origin so we can diagnose CORS issues
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// CORS: allow all in development; set safe origin + support preflight
if (process.env.NODE_ENV === 'development') {
  app.use(cors({ origin: true, credentials: true }));
  // Ensure pre-flight passes
  app.options('*', cors({ origin: true, credentials: true }));
} else {
  const allowedOrigins = (process.env.FRONTEND_URL?.split(',') || ['http://localhost:8100']).map((s) => s.trim().replace(/\/$/, ''));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = (req.headers.origin as string | undefined) || undefined;
    const originNormalized = origin ? origin.replace(/\/$/, '') : origin;
    const allowedExplicit = originNormalized && allowedOrigins.includes(originNormalized);
    const allowedLocal = originNormalized && (originNormalized.includes('localhost') || originNormalized.includes('127.0.0.1') || originNormalized.includes('ngrok.io'));
    if (!origin || allowedExplicit || allowedLocal) {
      const allowOrigin = origin || (allowedOrigins.length > 0 ? allowedOrigins[0] : '*');
      res.header('Access-Control-Allow-Origin', allowOrigin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      console.log(`CORS allowed origin: ${origin}`);
      next();
    } else {
      console.warn(`CORS denied origin: ${origin}`);
      res.status(403).json({ success: false, message: 'CORS origin denied', origin });
    }
  });
}

// PayMongo API configuration
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || 'sk_test_your_key_here';
const PAYMONGO_BASE_URL = 'https://api.paymongo.com/v1';

// use env-driven model name so it's easy to switch
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Trusted Filipino meals (USDA/DOST-PH)
const trustedFilipinoMeals = [
  "Chicken Adobo", "Pork Adobo", "Beef Tapa", "Bangus Sinigang", "Tinolang Manok", "Laing",
  "Pinakbet", "Sinigang na Baboy", "Tortang Talong", "Ginisang Monggo", "Paksiw na Isda",
  "Pancit Bihon", "Arroz Caldo", "Kare-Kare", "Paksiw na Lechon", "Ensaladang Talong",
  "Inihaw na Liempo", "Lumpiang Sariwa", "Paksiw na Bangus", "Ginataang Gulay", "La Paz Batchoy",
  "Dinuguan", "Menudo", "Bicol Express", "Pochero", "Bulalo", "Pancit Canton", "Tapsilog",
  "Tocilog", "Longsilog", "Daing na Bangus", "Tinapang Bangus", "Chicken Inasal", "Paksiw na Pata",
  "Paksiw na Tilapia", "Ginisang Ampalaya", "Ginisang Sitaw at Kalabasa", "Ginisang Pechay",
  "Ginisang Repolyo", "Ginisang Sayote", "Ginisang Upo", "Ginisang Patola", "Ginisang Togue",
  "Ginisang Okra", "Ginisang Malunggay", "Ginisang Kangkong", "Ginisang Alugbati", "Ginisang Bataw",
  "Ginisang Sigarilyas", "Pancit Palabok", "Pancit Malabon", "Pancit Habhab", "Pancit Molo",
  "Sinigang na Hipon", "Sinigang na Isda", "Sinigang na Baka", "Pritong Tilapia", "Pritong Bangus",
  "Tinolang Tahong", "Tinolang Isda", "Tinolang Baboy", "Tinolang Hipon", "Tinolang Gulay",
  "Pinapaitan", "Papaitan", "Igado", "Bagnet", "Dinakdakan", "Kilawin", "Paksiw na Pata",
  "Paksiw na Lechon", "Paksiw na Tilapia", "Paksiw na Bangus", "Paksiw na Galunggong",
  "Paksiw na Dilis", "Paksiw na Tulingan", "Paksiw na Pusit", "Paksiw na Baboy", "Paksiw na Manok",
  "Paksiw na Baka", "Paksiw na Hipon", "Paksiw na Gulay", "Paksiw na Labanos", "Paksiw na Ampalaya",
  "Paksiw na Talong", "Paksiw na Okra", "Paksiw na Sitaw", "Paksiw na Kalabasa", "Paksiw na Upo",
  "Paksiw na Patola", "Paksiw na Bataw", "Paksiw na Sigarilyas"
];

// Extended trustedFilipinoMealsDetailed with more meals and macros
const trustedFilipinoMealsDetailed = [
  { name: "Chicken Adobo", ingredients: ["chicken","soy sauce","vinegar"], calories: 480, protein: 36, carbs: 50, fats: 14, fiber: 2, recipe: "" },
  { name: "Pork Adobo", ingredients: ["pork","soy","vinegar"], calories: 520, protein: 32, carbs: 52, fats: 22, fiber: 2, recipe: "" },
  { name: "Tapsilog", ingredients: ["beef tapa","garlic rice","egg"], calories: 520, protein: 36, carbs: 48, fats: 16, fiber: 2, recipe: "" },
  { name: "Bangus Sinigang", ingredients: ["bangus","sinigang mix","vegetables"], calories: 410, protein: 32, carbs: 46, fats: 10, fiber: 3, recipe: "" },
  { name: "Tinolang Manok", ingredients: ["chicken","ginger","malunggay"], calories: 390, protein: 34, carbs: 44, fats: 8, fiber: 3, recipe: "" },
  { name: "Laing", ingredients: ["gabi leaves","coconut milk"], calories: 350, protein: 12, carbs: 38, fats: 16, fiber: 5, recipe: "" },
  { name: "Pinakbet", ingredients: ["eggplant","ampalaya","sitaw","okra","shrimp paste"], calories: 300, protein: 12, carbs: 30, fats: 10, fiber: 6, recipe: "" },
  { name: "Pancit Bihon", ingredients: ["bihon noodles","chicken","carrots","cabbage"], calories: 420, protein: 18, carbs: 62, fats: 8, fiber: 4, recipe: "" },
  { name: "Arroz Caldo", ingredients: ["rice","chicken","ginger","egg"], calories: 390, protein: 20, carbs: 54, fats: 8, fiber: 2, recipe: "" },
  { name: "Kare-Kare", ingredients: ["oxtail","peanut sauce","vegetables"], calories: 540, protein: 28, carbs: 52, fats: 22, fiber: 5, recipe: "" },
  { name: "Lumpiang Sariwa", ingredients: ["spring roll wrapper","mixed vegetables","peanut sauce"], calories: 260, protein: 8, carbs: 38, fats: 8, fiber: 4, recipe: "" },
  { name: "Daing na Bangus", ingredients: ["bangus","vinegar","garlic"], calories: 410, protein: 32, carbs: 44, fats: 10, fiber: 2, recipe: "" },
  { name: "Chicken Inasal", ingredients: ["chicken leg","annatto oil","vinegar"], calories: 420, protein: 34, carbs: 44, fats: 10, fiber: 2, recipe: "" },
  { name: "Ginisang Monggo", ingredients: ["mung beans","garlic","pork bits","spinach"], calories: 340, protein: 18, carbs: 44, fats: 8, fiber: 6, recipe: "" },
  { name: "La Paz Batchoy", ingredients: ["egg noodles","pork","liver","egg"], calories: 480, protein: 22, carbs: 60, fats: 14, fiber: 2, recipe: "" },
  { name: "Bicol Express", ingredients: ["pork","coconut milk","chili","shrimp paste"], calories: 520, protein: 24, carbs: 52, fats: 22, fiber: 3, recipe: "" },
  { name: "Paksiw na Bangus", ingredients: ["bangus","vinegar","eggplant"], calories: 380, protein: 28, carbs: 40, fats: 10, fiber: 4, recipe: "" },
  { name: "Bulalo", ingredients: ["beef shank","corn","greens"], calories: 520, protein: 32, carbs: 50, fats: 18, fiber: 3, recipe: "" },
  { name: "Tinolang Isda", ingredients: ["fish","ginger","papaya","greens"], calories: 350, protein: 28, carbs: 38, fats: 8, fiber: 3, recipe: "" },
  { name: "Pochero", ingredients: ["pork/beef","plantains","vegetables"], calories: 500, protein: 28, carbs: 54, fats: 16, fiber: 5, recipe: "" },
];

// ===== AUTHENTICATION MIDDLEWARE =====
interface AuthRequest extends Request {
  user?: any;
}

const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('🔐 Auth Header:', authHeader);
  console.log('🎫 Token:', token ? 'Present' : 'Missing');

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ 
      success: false,
      message: 'Access token required' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('✅ Token verified, user ID:', decoded.id);
    req.user = decoded;
    next();
  } catch (err: any) {
    console.log('❌ Token verification failed:', getErrorMessage(err)); // changed
    return res.status(403).json({ 
      success: false,
      message: 'Invalid or expired token' 
    });
  }
};

// ===== HELPER FUNCTIONS =====

async function enhanceAIWeekPlanWithDetails(parsedWeekPlan: any[], dishes: any[]) {
  if (!Array.isArray(parsedWeekPlan)) return [];

  return parsedWeekPlan.map((dayObj: any) => {
    const mealsInput = dayObj.meals || {};
    const enrichedMeals: Record<string, any> = {};

    for (const [mealType, mealValue] of Object.entries(mealsInput)) {
      let mealName = "";
      if (typeof mealValue === "string") {
        mealName = mealValue;
      } else if (mealValue && typeof mealValue === "object") {
        mealName = (mealValue as any).name || "";
      }

      const dish = dishes.find((d: any) => String(d.name || "").toLowerCase() === String(mealName || "").toLowerCase());
      if (dish) {
        let ingredients: string[] = [];
        try {
          if (typeof dish.ingredients === "string") {
            ingredients = JSON.parse(String(dish.ingredients));
            if (!Array.isArray(ingredients)) ingredients = [String(dish.ingredients)];
          } else if (Array.isArray(dish.ingredients)) {
            ingredients = dish.ingredients;
          } else {
            ingredients = [];
          }
        } catch (e: any) {
          ingredients = String(dish.ingredients || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        }

        enrichedMeals[mealType] = {
          name: dish.name,
          ingredients,
          portionSize: dish.portion_size || "1 serving",
          calories: Number(dish.calories ?? dish.cal ?? 0),
          protein: Number(dish.protein ?? dish.pro ?? 0),
          carbs: Number(dish.carbs ?? dish.carb ?? 0),
          fats: Number(dish.fats ?? dish.fat ?? 0),
          fiber: Number(dish.fiber ?? 0),
          recipe: dish.recipe || (mealValue && (mealValue as any).recipe) || ""
        };
      } else {
        if (typeof mealValue === "object" && mealValue !== null) {
          enrichedMeals[mealType] = createMealObject(mealValue);
        } else {
          enrichedMeals[mealType] = createMealObject({ name: mealName || "Unnamed Meal" });
        }
      }
    }

    const totals = sumMacros(Object.values(enrichedMeals));
    return {
      day: dayObj.day || dayObj.dayName || "",
      meals: enrichedMeals,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFats: totals.fats,
    };
  });
}

function createMealObject(meal: any) {
  return {
    name: meal.name || "Unnamed Meal",
    ingredients: meal.ingredients || [],
    portionSize: meal.portionSize || "1 serving",
    calories: Number(meal.calories ?? meal.cal ?? 0),
    protein: Number(meal.protein ?? meal.pro ?? 0),
    carbs: Number(meal.carbs ?? meal.carb ?? 0),
    fats: Number(meal.fats ?? meal.fat ?? 0),
    fiber: Number(meal.fiber ?? 0),
    recipe: meal.recipe || "No recipe provided",
  };
}

function generateShoppingList(weekPlan: any[]) {
  const ingredientCounts: Record<string, number> = {};

  if (!Array.isArray(weekPlan)) return [];

  weekPlan.forEach((day: any) => {
    Object.values(day.meals).forEach((meal: any) => {
      if (meal && Array.isArray(meal.ingredients)) {
        meal.ingredients.forEach((ing: string) => {
          const normalized = ing.trim().toLowerCase();
          ingredientCounts[normalized] = (ingredientCounts[normalized] || 0) + 1;
        });
      }
    });
  });

  const shoppingList = Object.entries(ingredientCounts).map(([ingredient, count]) => ({
    ingredient,
    estimate: `${count} portion(s)`,
  }));

  shoppingList.sort((a: any, b: any) => (b.estimate.length - a.estimate.length));
  return shoppingList;
}

function getMealPrepTips(weekPlan: any[]) {
  const tips: string[] = [
    "Batch-cook rice (3-4 servings) and freeze in portion containers.",
    "Roast or grill proteins on one day to use across multiple meals.",
    "Chop vegetables and store them in airtight containers for quick cooking.",
    "Prepare sauces and dressings in a jar to add flavor quickly.",
    "Portion meals in reusable containers labeled by day to speed up reheating and reduce waste."
  ];

  const stewDays = (weekPlan || []).filter((d: any) =>
    Object.values(d.meals).some((m: any) => m.name && /sinigang|tinola|bulalo|pochero/i.test(m.name))
  );
  if (stewDays.length >= 2) {
    tips.push("Make a big batch of broths (sinigang/tinola/bulalo) and freeze in portions for quick lunches/dinners.");
  }

  const friedCount = (weekPlan || []).reduce((acc: number, day: any) => {
    const dayFried = Object.values(day.meals).filter((m: any) => m.name && /fried|crispy|prito|daing|tapa|longganisa|spamsilog/i.test(m.name)).length;
    return acc + dayFried;
  }, 0);
  if (friedCount >= 4) {
    tips.push("For fried items, consider pan-searing instead of deep frying to reduce oil use and cleanup time.");
  }

  return tips;
}

function getNutritionTips(goal: string) {
  const normalizedGoal = (goal || "").toLowerCase();
  switch (normalizedGoal) {
    case "muscle gain":
    case "gain":
      return [
        "Increase protein intake at every meal (aim for 20–40g per meal).",
        "Include a mix of fast-digesting carbs and protein post-workout (e.g., rice + chicken).",
        "Use healthy fats (avocado, coconut, nuts) to increase calorie density."
      ];
    case "weight loss":
    case "loss":
      return [
        "Focus on lean proteins and vegetables to increase satiety.",
        "Reduce portion sizes of calorie-dense foods and favor low-calorie volume foods (leafy greens, broth-based soups).",
        "Avoid sugary beverages and reduce fried foods; use steamed or grilled methods."
      ];
    default:
      return [
        "Balance protein, carbs, and fats throughout the day.",
        "Aim for whole foods and fiber-rich vegetables to maintain steady energy.",
        "Drink plenty of water and keep sodium moderate to reduce water retention."
      ];
  }
}

function shuffleArray<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sumMacros(meals: any[]) {
  const totals = { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 };
  meals.forEach((m: any) => {
    totals.calories += Number(m.calories || m.cal || 0);
    totals.protein += Number(m.protein || m.pro || 0);
    totals.carbs += Number(m.carbs || m.carb || 0);
    totals.fats += Number(m.fats || m.fat || 0);
    totals.fiber += Number(m.fiber || 0);
  });
  return totals;
}

function pickUniqueMeals(source: any[], used: Set<string>, count: number) {
  let pool = source.filter(m => !used.has(m.name));
  if (pool.length < count) {
    used.clear();
    pool = [...source];
  }
  const shuffled = shuffleArray(pool);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));
  picked.forEach(m => used.add(m.name));
  return picked;
}

function generateWeekPlan(aiDay: any | null, targets: any, goal: string) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const used = new Set<string>();
  const weekPlan: any[] = [];

  if (aiDay && aiDay.meals) {
    Object.values(aiDay.meals).forEach((m: any) => {
      if (m && m.name) used.add(m.name);
    });
  }

  for (const day of DAYS) {
    if (aiDay && aiDay.day === day) {
      const normalizedMeals: any = {};
      Object.entries(aiDay.meals || {}).forEach(([k,v]: any) => {
        normalizedMeals[k] = createMealObject(v);
        if (normalizedMeals[k].name) used.add(normalizedMeals[k].name);
      });
      const totals = sumMacros(Object.values(normalizedMeals));
      weekPlan.push({
        day,
        meals: normalizedMeals,
        totalCalories: totals.calories,
        totalProtein: totals.protein,
        totalCarbs: totals.carbs,
        totalFats: totals.fats
      });
      continue;
    }

    const picks = pickUniqueMeals(trustedFilipinoMealsDetailed, used, 5);

    while (picks.length < 5) {
      const fallback = trustedFilipinoMealsDetailed[Math.floor(Math.random() * trustedFilipinoMealsDetailed.length)];
      if (!picks.find(p => p.name === fallback.name)) picks.push(fallback);
    }

    const mealsObj: any = {
      breakfast: createMealObject(picks[0]),
      lunch: createMealObject(picks[1]),
      dinner: createMealObject(picks[2]),
      snack1: createMealObject(picks[3]),
      snack2: createMealObject(picks[4]),
    };

    const totals = sumMacros(Object.values(mealsObj));
    weekPlan.push({
      day,
      meals: mealsObj,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFats: totals.fats
    });
  }

  return weekPlan;
}

// Safe OpenAI wrapper with timeout
async function safeOpenAICompletionsCreate(params: any, timeoutMs = 12000): Promise<any> {
  if (!openai) {
    throw new Error('OpenAI not configured');
  }
  try {
    const promise = openai.chat.completions.create(params);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('OpenAI timeout')), timeoutMs));
    const completion = await Promise.race([promise, timeout]);
    openaiAvailable = true;
    return completion;
  } catch (err: any) {
    const errMsg = getErrorMessage(err); // changed
    const status = (err?.status || err?.response?.status || err?.code) as any;
    const isAuthErr = status === 401 || /Incorrect API key/i.test(errMsg) || /invalid api key/i.test(errMsg); // changed to use errMsg
    if (isAuthErr) {
      openaiAvailable = false;
      console.warn('OpenAI unauthorized: check OPENAI_API_KEY (rotate key).');
      const e = new Error('OPENAI_UNAUTHORIZED');
      (e as any).status = 401;
      throw e;
    }
    throw err;
  }
}

// Utility: ensure a user preference row exists; return its id or null
async function ensureUserPreferenceExists(userId: number): Promise<number | null> {
  try {
    const [rows] = await pool.query<any[]>('SELECT id FROM user_meal_preferences WHERE user_id = ?', [userId]);
    if (Array.isArray(rows) && rows.length > 0) {
      return Number(rows[0].id);
    }

    const [insertResult] = await pool.query<any>(
      `INSERT INTO user_meal_preferences (user_id, preferences, created_at)
       VALUES (?, ?, NOW())`,
      [ userId, JSON.stringify({}) ]
    );

    return Number(insertResult.insertId || null);
  } catch (err: any) {
    // Use the helper to extract message safely
    console.warn('Failed to ensure preference exists:', getErrorMessage(err));
    return null;
  }
}

// Add helper to safely extract message from unknown errors
function getErrorMessage(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    if (typeof err === 'object' && err !== null && 'message' in err) {
      return String((err as any).message || JSON.stringify(err));
    }
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Add this helper below getErrorMessage() and above route handlers
function isoDateString(input?: Date | string | null): string {
  if (!input) return new Date().toISOString().split('T')[0];
  const d = input instanceof Date ? input : new Date(String(input));
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  return d.toISOString().split('T')[0];
}

// ===== BASIC ROUTES =====
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      port: process.env.DB_PORT || '3308'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: 'Database connection failed'
    });
  }
});

app.get('/api/system/status', async (req: Request, res: Response) => {
  try {
    let dbOk = false;
    try {
      await pool.query('SELECT 1');
      dbOk = true;
    } catch (e) {
      dbOk = false;
    }

    const openaiOk = !!process.env.OPENAI_API_KEY && typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0;

    let paymongoOk = false;
    try {
      await axios.get(PAYMONGO_BASE_URL + '/v1/sources', {
        timeout: 1500,
        auth: { username: (process.env.PAYMONGO_SECRET_KEY || ''), password: '' }
      });
      paymongoOk = true;
    } catch (e) {
      paymongoOk = false;
    }

    return res.json({
      ok: true,
      dbConnected: dbOk,
      openai: openaiOk,
      paymongo: paymongoOk,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: getErrorMessage(err) }); // changed
  }
});

// ===== AUTHENTICATION ROUTES =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('\n🔐 Login attempt for:', email);

    const [users] = await pool.query<any[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!Array.isArray(users) || users.length === 0) {
      console.log('❌ User not found');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = users[0];
    console.log('✅ User found:', user.email);

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log('❌ Invalid password');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );

    console.log('✅ Login successful\n');
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('❌ Login error:', getErrorMessage(error)); // changed
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    const [users] = await pool.query<any[]>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error: any) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      gender,
      dateOfBirth,
      membershipType,
      membershipPrice,
      emergencyContact,
      address,
      joinDate,
    } = req.body;

    console.log('\n➕ Registering new member:', email);

    if (!firstName || !lastName || !email || !password || !phone) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if ((existingUsers as any[]).length > 0) {
      console.log('❌ Email already registered');
      return res.status(400).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    console.log('🔐 Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 12);

    const subscriptionStart = new Date();
    const subscriptionEnd = new Date();
    
    switch (membershipType || 'monthly') {
      case 'monthly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
        break;
      case 'quarterly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 3);
        break;
      case 'annual':
        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
        break;
    }

    console.log('💾 Inserting member into database...');
    
    const [result] = await pool.query(
      `INSERT INTO users (
        first_name, last_name, email, password, phone, 
        gender, date_of_birth, role, status,
        membership_type, membership_price, join_date,
        subscription_start, subscription_end,
        payment_status, emergency_contact, address,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'member', 'active', ?, ?, ?, ?, ?, 'pending', ?, ?, NOW())`,
      [
        firstName,
        lastName,
        email,
        hashedPassword,
        phone,
        gender || 'male',
        dateOfBirth || null,
        membershipType || 'monthly',
        membershipPrice || 1500,
        isoDateString(req.body?.joinDate || joinDate), // safe access — prefer req.body.joinDate if present
        isoDateString(subscriptionStart), // was subscriptionStart.toISOString().split('T')[0]
        isoDateString(subscriptionEnd), // was subscriptionEnd.toISOString().split('T')[0]
        emergencyContact || null,
        address || null,
      ]
    );

    const userId = (result as any).insertId;

    console.log(`✅ Member registered successfully with ID: ${userId}\n`);

    res.status(201).json({
      success: true,
      message: 'Member registered successfully',
      userId,
    });
  } catch (error: any) {
    console.error('❌ Registration error:', getErrorMessage(error)); // changed
    res.status(500).json({ 
      success: false, 
      message: getErrorMessage(error) || 'Registration failed' 
    });
  }
});

// ===== MEMBER MANAGEMENT ROUTES =====
app.get('/api/members', async (req, res) => {
  try {
    console.log('📋 Fetching all members with payment info...');
    
    const [members] = await pool.query<any[]>(
      `SELECT 
        u.id, 
        u.email, 
        u.first_name as firstName, 
        u.last_name as lastName,
        u.phone,
        u.gender,
        u.date_of_birth as dateOfBirth,
        u.membership_type as membershipType,
        u.membership_price as membershipPrice,
        u.join_date as joinDate,
        u.status,
        u.payment_status as paymentStatus,
        u.subscription_start as subscriptionStart,
        u.subscription_end as subscriptionEnd,
        u.emergency_contact as emergencyContact,
        u.address,
        COUNT(p.id) as totalPayments
      FROM users u
      LEFT JOIN payments p ON u.id = p.user_id
      WHERE u.role = "member"
      GROUP BY u.id`
    );

    console.log(`✅ Found ${members.length} members`);
    
    const transformedMembers = members.map((member: any) => ({
      id: member.id,
      firstName: member.firstName || '',
      lastName: member.lastName || '',
      email: member.email,
      phone: member.phone || '',
      gender: member.gender || 'male',
      dateOfBirth: member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().split('T')[0] : '',
      membershipType: member.membershipType || 'monthly',
      membershipPrice: parseFloat(member.membershipPrice) || 1500,
      joinDate: member.joinDate ? new Date(member.joinDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: member.status || 'active',
      paymentStatus: member.paymentStatus || 'pending',
      subscriptionStart: member.subscriptionStart ? new Date(member.subscriptionStart).toISOString().split('T')[0] : null,
      subscriptionEnd: member.subscriptionEnd ? new Date(member.subscriptionEnd).toISOString().split('T')[0] : null,
      emergencyContact: member.emergencyContact || '',
      address: member.address || '',
      totalPayments: member.totalPayments || 0,
    }));

    res.json(transformedMembers);
  } catch (error: any) {
    console.error('❌ Error fetching members:', getErrorMessage(error)); // changed
    res.status(500).json({ message: 'Server error', error: getErrorMessage(error) });
  }
});

app.post('/api/members', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      password, 
      phone, 
      gender, 
      dateOfBirth, 
      membershipType, 
      membershipPrice,
      joinDate,
      status,
      emergencyContact,
      address,
      
    } = req.body;

    console.log('\n➕ Admin adding new member:', email);

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const [existing] = await pool.query<any[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      console.log('❌ Email already exists:', email);
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const subscriptionStart = new Date();
    const subscriptionEnd = new Date();
    
    switch(membershipType) {
      case 'monthly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
        break;
      case 'quarterly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 3);
        break;
      case 'annual':
        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
        break;
    }
    
    const [result] = await pool.query(
      `INSERT INTO users (
        first_name, last_name, email, password, phone, 
        gender, date_of_birth, role, status,
        membership_type, membership_price, join_date,
        subscription_start, subscription_end,
        payment_status, emergency_contact, address,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW())`,
      [
        firstName,
        lastName,
        email,
        hashedPassword,
        phone,
        gender || 'male',
        dateOfBirth || null,
        status || 'active',
        membershipType || 'monthly',
        membershipPrice || 1500,
        joinDate || isoDateString(new Date()), // in the insert values: use isoDateString for joinDate default
        isoDateString(subscriptionStart), // was subscriptionStart.toISOString().split('T')[0]
        isoDateString(subscriptionEnd),   // was subscriptionEnd.toISOString().split('T')[0]
        emergencyContact || null,
        address || null
      ]
    );

    const insertId = (result as any).insertId;

    console.log(`✅ Member added with ID: ${insertId}\n`);

    res.status(201).json({ 
      success: true,
      message: 'Member added successfully',
      id: insertId
    });
  } catch (error: any) {
    console.error('❌ Error adding member:', getErrorMessage(error)); // changed
    res.status(500).json({ success: false, message: 'Server error', error: getErrorMessage(error) });
  }
});

app.put('/api/members/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const memberId = req.params.id;
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      gender,
      dateOfBirth,
      membershipType,
      membershipPrice,
      status,
      emergencyContact,
      address,
      joinDate,
    } = req.body;

    console.log(`📝 Updating member ID: ${memberId}`);

    let updateFields = [];
    let updateValues = [];

    if (firstName) {
      updateFields.push('first_name = ?');
      updateValues.push(firstName);
    }
    if (lastName) {
      updateFields.push('last_name = ?');
      updateValues.push(lastName);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 12);
      updateFields.push('password = ?');
      updateValues.push(hashedPassword);
    }
    if (phone) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (gender) {
      updateFields.push('gender = ?');
      updateValues.push(gender);
    }
    if (dateOfBirth) {
      updateFields.push('date_of_birth = ?');
      updateValues.push(dateOfBirth);
    }
    if (membershipType) {
      updateFields.push('membership_type = ?');
      updateValues.push(membershipType);
    }
    if (membershipPrice) {
      updateFields.push('membership_price = ?');
      updateValues.push(membershipPrice);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (emergencyContact !== undefined) {
      updateFields.push('emergency_contact = ?');
      updateValues.push(emergencyContact);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    updateValues.push(memberId);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    console.log('✅ Member updated successfully');

    res.json({ 
      success: true,
      message: 'Member updated successfully' 
    });
  } catch (error: any) {
    console.error('❌ Error updating member:', getErrorMessage(error)); // changed
    res.status(500).json({ success: false, message: 'Server error', error: getErrorMessage(error) });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`\n🗑️ Deleting member ID: ${id}`);

    const [result] = await pool.query(
      'DELETE FROM users WHERE id = ? AND role = "member"',
      [id]
    );

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    console.log(`✅ Member deleted successfully\n`);
    res.json({ message: 'Member deleted successfully' });
  } catch (error: any) {
    console.error('❌ Error deleting member:', getErrorMessage(error)); // changed
    res.status(500).json({ message: 'Server error', error: getErrorMessage(error) });
  }
});

// ===== PAYMENT ROUTES =====
app.get('/api/member/subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [member] = await pool.query<any[]>(
      `SELECT 
        id, email, first_name as firstName, last_name as lastName,
        membership_type as membershipType, membership_price as membershipPrice,
        subscription_start as subscriptionStart, subscription_end as subscriptionEnd,
        payment_status as paymentStatus, status
      FROM users WHERE id = ? AND role = 'member'`,
      [userId]
    );

    if (member.length === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    res.json(member[0]);
  } catch (error: any) {
    console.error('❌ Error fetching subscription:', getErrorMessage(error)); // changed
    res.status(500).json({ message: 'Server error', error: getErrorMessage(error) });
  }
});

app.post('/api/member/payment/gcash', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, membershipType, amount, paymentMethod } = req.body;

    console.log('\n💳 Processing GCash AUTO-APPROVAL payment:', { userId, membershipType, amount, paymentMethod });

    if (!userId || !membershipType || !amount) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
      });
    }

    const transactionId = `GCASH-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const subscriptionStart = new Date();
    const subscriptionEnd = new Date();
    
    switch (membershipType) {
      case 'monthly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
        break;
      case 'quarterly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 3);
        break;
      case 'annual':
        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
        break;
    }

    const paymentStatus = 'paid';
    console.log(`📝 GCash payment → Status: ${paymentStatus} (AUTO-APPROVED)`);

    const [result] = await pool.query(
      `INSERT INTO payments (
        user_id, amount, payment_date, payment_method,
        membership_type, payment_status, transaction_id,
        subscription_start, subscription_end
      ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
      [
        userId, 
        amount, 
        paymentMethod || 'gcash', 
        membershipType, 
        paymentStatus, 
        transactionId,
        isoDateString(subscriptionStart), // was subscriptionStart.toISOString().split('T')[0]
        isoDateString(subscriptionEnd),   // was subscriptionEnd.toISOString().split('T')[0]
      ]
    );

    await pool.query(
      `UPDATE users 
       SET status = 'active',
           payment_status = 'paid',
           subscription_start = ?,
           subscription_end = ?,
           membership_type = ?,
           membership_price = ?
       WHERE id = ?`,
      [
        isoDateString(subscriptionStart), // was subscriptionStart.toISOString().split('T')[0]
        isoDateString(subscriptionEnd),   // was subscriptionEnd.toISOString().split('T')[0]
        membershipType,
        amount,
        userId
      ]
    );

    console.log('✅ GCash payment approved instantly!');

    res.status(201).json({
      success: true,
      message: '✅ Payment successful! Your subscription is now active.',
      paymentId: (result as any).insertId,
      transactionId,
      paymentStatus: 'paid',
      subscription: {
        start: subscriptionStart.toISOString().split('T')[0],
        end: subscriptionEnd.toISOString().split('T')[0],
        type: membershipType,
        amount: amount
      }
    });

  } catch (error: any) {
    console.error('❌ GCash payment error:', getErrorMessage(error)); // changed
    res.status(500).json({ success: false, message: getErrorMessage(error) || 'Payment processing failed' });
  }
});

app.post('/api/admin/payments/record-cash', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, membershipType, amount, paymentMethod, notes } = req.body;

    if (!userId || !amount || !membershipType) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
      });
    }

    const transactionId = `CASH-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const subscriptionStart = new Date();
    const subscriptionEnd = new Date();
    
    switch (membershipType) {
      case 'monthly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
        break;
      case 'quarterly':
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 3);
        break;
      case 'annual':
        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
        break;
    }

    const paymentStatus = 'paid';

    const [result] = await pool.query(
      `INSERT INTO payments (
        user_id, amount, payment_date, payment_method,
        membership_type, payment_status, transaction_id,
        subscription_start, subscription_end, notes
      ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, 
        amount, 
        paymentMethod || 'cash', 
        membershipType, 
        paymentStatus, 
        transactionId,
        isoDateString(subscriptionStart),
        isoDateString(subscriptionEnd),
        notes || ''
      ]
    );

    await pool.query(
      `UPDATE users 
       SET status = 'active',
           payment_status = 'paid',
           subscription_start = ?,
           subscription_end = ?,
           membership_type = ?,
           membership_price = ?
       WHERE id = ?`,
      [
        isoDateString(subscriptionStart),
        isoDateString(subscriptionEnd),
        membershipType,
        amount,
        userId
      ]
    );

    res.status(201).json({
      success: true,
      message: '✅ Payment recorded! Member subscription is now active.',
      paymentId: (result as any).insertId,
      transactionId,
      paymentStatus: 'paid',
      subscription: {
        start: subscriptionStart.toISOString().split('T')[0],
        end: subscriptionEnd.toISOString().split('T')[0],
        type: membershipType,
        amount: amount
      }
    });

  } catch (error: any) {
    console.error('❌ Cash payment recording error:', getErrorMessage(error));
    res.status(500).json({ success: false, message: getErrorMessage(error) || 'Failed to record payment' });
  }
});

// GET ALL PAYMENTS FOR ADMIN DASHBOARD (ADMIN)
app.get('/api/admin/payments/all', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const [payments] = await pool.query<any[]>(`
      SELECT 
        p.id,
        p.user_id,
        p.amount,
        p.payment_method,
        p.membership_type,
        COALESCE(p.payment_status, 'paid') as payment_status,
        p.payment_date,
        p.transaction_id,
        p.subscription_start,
        p.subscription_end,
        p.notes,
        u.first_name as firstName,
        u.last_name as lastName,
        u.email
      FROM payments p
      INNER JOIN users u ON p.user_id = u.id
      ORDER BY p.payment_date DESC
    `);

    res.json(payments);
  } catch (error: any) {
    console.error('❌ Get all payments error:', getErrorMessage(error));
    res.status(500).json({ success: false, message: 'Failed to get payments', error: getErrorMessage(error) });
  }
});

// ADMIN PAYMENT SUMMARY ROUTE
app.get('/api/admin/payments/summary', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Total revenue (sum of all paid payments)
    const [revenueRows] = await pool.query<any[]>(`
      SELECT SUM(amount) as totalRevenue
      FROM payments
      WHERE payment_status = 'paid'
    `);

    // Count of pending payments
    const [pendingRows] = await pool.query<any[]>(`
      SELECT COUNT(*) as pendingPayments
      FROM payments
      WHERE payment_status = 'pending'
    `);

    // Count of paid payments
    const [paidRows] = await pool.query<any[]>(`
      SELECT COUNT(*) as paidPayments
      FROM payments
      WHERE payment_status = 'paid'
    `);

    res.json({
      success: true,
      totalRevenue: Number(revenueRows[0]?.totalRevenue) || 0,
      pendingPayments: Number(pendingRows[0]?.pendingPayments) || 0,
      paidPayments: Number(paidRows[0]?.paidPayments) || 0,
    });
  } catch (err: any) {
    console.error('❌ Payment summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to get payment summary' });
  }
});

// ===== MEAL PLANNER ROUTES =====
// GENERATE MEAL PLAN (AI-POWERED)
app.post('/api/meal-planner/generate', authenticateToken, async (req: AuthRequest, res: Response) => {
  console.log('🔄 /api/meal-planner/generate hit');

  try {
    const userId = req.user!.id;
    const { lifestyle, mealType, goal, dietaryRestrictions, targets, planName } = req.body;

    if (!dbConnected) {
      console.warn('Database not connected: returning local fallback week plan');
      const weekPlan = generateWeekPlan(null, targets, goal);
      return res.status(503).json({
        success: false,
        message: 'Database not connected — returning fallback plan',
        mealPlan: {
          weekPlan,
          shoppingList: generateShoppingList(weekPlan),
          mealPrepTips: getMealPrepTips(weekPlan),
          nutritionTips: getNutritionTips(goal)
        },
        saved: false
      });
    }

    const [dbDishes] = await pool.query<any[]>('SELECT * FROM filipino_dishes ORDER BY name ASC');

    const dishesForPrompt = dbDishes.map(d => ({
      name: d.name,
      category: d.category,
      calories: Number(d.calories ?? d.cal ?? 0),
      protein: Number(d.protein ?? d.pro ?? 0),
      carbs: Number(d.carbs ?? d.carb ?? 0),
      fats: Number(d.fats ?? d.fat ?? 0),
      ingredients: typeof d.ingredients === 'string' ? d.ingredients : (d.ingredients || [])
    }));
    const dishesJson = JSON.stringify(dishesForPrompt);

    const prompt = `
You are a professional Filipino nutritionist and meal planner. The user preferences:
- Lifestyle: ${lifestyle}
- Type: ${mealType}
- Goal: ${goal}
- Restrictions: ${dietaryRestrictions}
- Targets: ${targets?.calories ?? 2000} kcal, ${targets?.protein ?? 150}g protein, ${targets?.carbs ?? 250}g carbs, ${targets?.fats ?? 70}g fats

Only use meals from the provided DB list (JSON) below:
${dishesJson}

Rules:
- Only use dishes that appear in the list (no new dishes).
- Randomize meals across days and avoid repeating the same meal on consecutive days.
- Return exactly JSON with "weekPlan": an array of 7 objects with structure:
  { "day":"Monday", "meals": { "breakfast": "Tapsilog"|{name:..., calories:..., ingredients:[]...}, ... }, "totalCalories": number, "totalProtein": number, "totalCarbs": number, "totalFats": number }
`;

    let weekPlan: any[] = [];
    let preferenceId: number | null = null;

    // Try to get user's preference id early
    try {
      const [prefRows] = await pool.query<any[]>('SELECT id FROM user_meal_preferences WHERE user_id = ?', [userId]);
      if (Array.isArray(prefRows) && prefRows.length > 0) {
        preferenceId = Number(prefRows[0].id);
      } else {
        preferenceId = await ensureUserPreferenceExists(userId);
        console.log('Created preference row for user:', userId, 'preferenceId:', preferenceId);
      }
    } catch (err: any) {
      // replaced unsafe access with helper
      console.warn('Could not fetch or create preference id for user:', getErrorMessage(err));
      preferenceId = null;
    }

    // If OpenAI key exists, try AI generation; else fallback immediately
    if (process.env.OPENAI_API_KEY && openaiAvailable) {
      try {
        const completion: any = await safeOpenAICompletionsCreate({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'You are a nutritionist and only use the provided list.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        }, 12000);

        const aiResponse = String((completion?.choices?.[0]?.message?.content) ?? '');
        let parsed: any = null;
        try {
          parsed = JSON.parse(aiResponse || '');
        } catch (parseErr: any) {
          console.warn('AI returned non-JSON or parse failed', getErrorMessage(parseErr)); // changed
        }

        if (parsed && Array.isArray(parsed.weekPlan) && parsed.weekPlan.length === 7) {
          weekPlan = await enhanceAIWeekPlanWithDetails(parsed.weekPlan, dbDishes);
        } else {
          const aiDay = parsed && parsed.weekPlan && parsed.weekPlan[0] ? parsed.weekPlan[0] : null;
          weekPlan = generateWeekPlan(aiDay, targets, goal);
        }
      } catch (aiErr: any) {
        console.warn('OpenAI generation failed — falling back to deterministic plan', getErrorMessage(aiErr)); // changed
        weekPlan = generateWeekPlan(null, targets, goal);
      }
    } else {
      weekPlan = generateWeekPlan(null, targets, goal);
    }

    // Build today's shopping list
    let todayShoppingList: any[] = [];
    try {
      const todayName = new Date().toLocaleString('en-US', { weekday: 'long' });
      const todayPlan = weekPlan.find((d: any) => d.day === todayName) || weekPlan[0];
      todayShoppingList = todayPlan ? generateShoppingList([todayPlan]) : [];
    } catch (err: any) {
      console.warn('Failed to compute today shopping list:', getErrorMessage(err)); // changed
    }

    // Save meal plan safely
    try {
      const safePlanName = planName || "Untitled Plan";

      // ensure we only include generated_at if the column exists
      const hasGeneratedAt = await dbColumnExists('meal_plans', 'generated_at');

      const insertCols = preferenceId === null
        ? (hasGeneratedAt ? 'user_id, plan_name, plan_data, generated_at' : 'user_id, plan_name, plan_data')
        : (hasGeneratedAt ? 'user_id, preference_id, plan_name, plan_data, generated_at' : 'user_id, preference_id, plan_name, plan_data');
  
      const insertValsBase = preferenceId === null
        ? [userId, safePlanName, JSON.stringify({ weekPlan })]
        : [userId, preferenceId, safePlanName, JSON.stringify({ weekPlan })];
  
      const insertVals = hasGeneratedAt ? [...insertValsBase, new Date()] : insertValsBase;

      const qMarks = insertVals.map(() => '?').join(', ');
      await pool.query(`INSERT INTO meal_plans (${insertCols}) VALUES (${qMarks})`, insertVals);
      console.log('Meal plan persisted successfully; preferenceId used:', preferenceId);
    } catch (err: any) {
      console.warn('Failed to persist generated meal plan, continuing without persistence:', getErrorMessage(err)); // changed
    }

    // Respond with meal plan
    res.json({
      success: true,
      mealPlan: {
        weekPlan,
        shoppingList: generateShoppingList(weekPlan),
        todayShoppingList,
        mealPrepTips: getMealPrepTips(weekPlan),
        nutritionTips: getNutritionTips(goal),
      },
      saved: !!preferenceId
    });
  } catch (err: any) {
    const errMsg = getErrorMessage(err); // changed
    console.error('Meal plan generation error:', errMsg);
    res.status(500).json({ success: false, message: 'Failed to generate meal plan', error: errMsg });
  }
});

app.post(['/api/meal-planner/regenerate', '/meal-planner/regenerate'], authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Accept flexible input shapes:
    const { dayIndex, day, mealType, mealKey, mealTypeKey, mealPlan, planId, excludeMealNames = [], currentMeal, dietaryRestrictions, targets, goal, lifestyle } = req.body || {};

    // Determine category for dish selection
    const category = mealTypeKey || mealType || mealKey || null;

    // Get dishes by category if category provided else fetch all
    let dishes: any[] = [];
    if (category) {
      const [rows] = await pool.query<any[]>('SELECT * FROM filipino_dishes WHERE category = ?', [category]);
      dishes = rows || [];
    }
    if (!Array.isArray(dishes) || dishes.length === 0) {
      const [rows] = await pool.query<any[]>('SELECT * FROM filipino_dishes ORDER BY name');
      dishes = rows || [];
    }

    // Normalize excluded names (lowercase)
    const excludeArr = (Array.isArray(excludeMealNames) ? excludeMealNames : (excludeMealNames ? [excludeMealNames] : []))
      .concat(currentMeal && typeof currentMeal === 'string' ? [currentMeal] : (currentMeal && currentMeal.name ? [currentMeal.name] : []))
      .map((n: any) => String(n || '').toLowerCase().trim())
      .filter(Boolean);

    // Fallback sample if no DB dishes
    if (!Array.isArray(dishes) || dishes.length === 0) {
      const fallbackDish = trustedFilipinoMealsDetailed[Math.floor(Math.random() * trustedFilipinoMealsDetailed.length)];
      return res.json({ success: true, newMeal: createMealObject(fallbackDish), source: 'fallback' });
    }

    // Helper: pick random excluding excludeArr
    function pickRandomExcluding(list: any[], exclude: string[]) {
      const pool = list.filter(d => !exclude.includes(String(d.name || '').toLowerCase().trim()));
      if (pool.length === 0) {
        // if nothing left, pick random and label alt
        const r = list[Math.floor(Math.random() * list.length)];
        return { ...r, name: `${r.name} (Alt)` };
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // Build prompt for AI if needed
    const dishListJson = JSON.stringify(dishes.map(d => ({ name: d.name, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats })));
    const excludeText = excludeArr.length > 0 ? `\nDo NOT return these dish names: ${excludeArr.join(', ')}` : '';
    const prompt = `
You are a nutritionist. Choose a single dish best suited for the user's ${String(category || mealType || 'meal')} from the list below.
User targets: ${targets?.calories ?? 2000} kcal, ${targets?.protein ?? 150}g protein, ${targets?.carbs ?? 250}g carbs, ${targets?.fats ?? 70}g fats.
Dietary restrictions: ${dietaryRestrictions || 'none'}.
${excludeText}
List: ${dishListJson}
Return JSON: { "newMeal": { "name":"...", "ingredients":[...], "calories":..., "protein":..., "carbs":..., "fats":..., "recipe":"..." } }
`;

    // Try OpenAI for regeneration
    if (process.env.OPENAI_API_KEY && openaiAvailable) {
      try {
        const completion: any = await safeOpenAICompletionsCreate({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'You are a Filipino nutritionist. Use only provided list.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 700
        }, 8000);

        const aiResponse = String((completion?.choices?.[0]?.message?.content) ?? '{}');
        let parsed: any = null;
        try { parsed = JSON.parse(aiResponse); } catch { parsed = null; }

        if (parsed && parsed.newMeal && parsed.newMeal.name) {
          const nameLower = String(parsed.newMeal.name).toLowerCase().trim();
          // If AI returns excluded name, fallback
          if (excludeArr.includes(nameLower)) {
            const picked = pickRandomExcluding(dishes, excludeArr);
            return res.json({ success: true, newMeal: createMealObject(picked), source: 'fallback-excluded' });
          }
          // If DB contains this dish, use DB result for accurate macros
          const found = dishes.find(d => String(d.name || '').toLowerCase().trim() === nameLower);
          if (found) {
            return res.json({ success: true, newMeal: createMealObject(found), source: 'ai' });
          }
          return res.json({ success: true, newMeal: createMealObject(parsed.newMeal), source: 'ai' });
        }
      } catch (err: any) {
        console.warn('AI regeneration failed, falling back to random pick:', getErrorMessage(err));
      }
    }

    // fallback deterministic pick that avoids excluded names
    const picked = pickRandomExcluding(dishes, excludeArr);
    return res.json({ success: true, newMeal: createMealObject(picked), source: 'fallback' });

  } catch (err: any) {
    console.error('Regenerate (alias) error:', getErrorMessage(err));
    return res.status(500).json({ success: false, message: 'Regenerate failed', error: getErrorMessage(err) });
  }
});

// helper to check if a column exists in a table (returns boolean)
async function dbColumnExists(table: string, column: string): Promise<boolean> {
  try {
    const dbName = process.env.DB_NAME || 'activecore';
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) as cnt 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [dbName, table, column]
    );
    return !!(rows && rows[0] && Number(rows[0].cnt) > 0);
  } catch (err: any) {
    console.warn('dbColumnExists error:', getErrorMessage(err));
    return false;
  }
}

// ===== MEAL-PLANNER: Save (create/update) - tolerant to generated_at/updated_at schema =====
app.post('/api/meal-planner/save', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { planId, planName, mealPlan } = req.body;

    if (!mealPlan || !Array.isArray(mealPlan)) {
      return res.status(400).json({ success: false, message: 'Invalid mealPlan payload' });
    }

    // ensure preference exists if needed (unchanged)
    let preferenceId: number | null = null;
    try {
      const [prefRows] = await pool.query<any[]>('SELECT id FROM user_meal_preferences WHERE user_id = ?', [userId]);
      if (Array.isArray(prefRows) && prefRows.length > 0) {
        preferenceId = Number(prefRows[0].id);
      } else {
        preferenceId = await ensureUserPreferenceExists(userId);
      }
    } catch (err: any) {
      preferenceId = null;
    }

    // Update (if planId provided) - use schema-aware column usage
    if (planId) {
      const hasUpdatedAt = await dbColumnExists('meal_plans', 'updated_at');
      try {
        if (hasUpdatedAt) {
          await pool.query('UPDATE meal_plans SET plan_name = ?, plan_data = ?, updated_at = NOW() WHERE id = ?', [
            planName || null, JSON.stringify({ weekPlan: mealPlan }), planId
          ]);
        } else {
          await pool.query('UPDATE meal_plans SET plan_name = ?, plan_data = ? WHERE id = ?', [
            planName || null, JSON.stringify({ weekPlan: mealPlan }), planId
          ]);
        }

        return res.json({ success: true, message: 'Meal plan updated', planId });
      } catch (updateErr: any) {
        console.warn('Update meal plan failed:', getErrorMessage(updateErr));
        return res.status(500).json({ success: false, message: 'Failed to update meal plan', error: getErrorMessage(updateErr) });
      }
    }

    // Insert new plan - handle generated_at if present
    try {
      const hasGeneratedAt = await dbColumnExists('meal_plans', 'generated_at');

      const insertCols = preferenceId === null
        ? (hasGeneratedAt ? 'user_id, plan_name, plan_data, generated_at' : 'user_id, plan_name, plan_data')
        : (hasGeneratedAt ? 'user_id, preference_id, plan_name, plan_data, generated_at' : 'user_id, preference_id, plan_name, plan_data');

      const insertValsBase = preferenceId === null
        ? [userId, planName || null, JSON.stringify({ weekPlan: mealPlan })]
        : [userId, preferenceId, planName || null, JSON.stringify({ weekPlan: mealPlan })];

      const insertVals = hasGeneratedAt ? [...insertValsBase, new Date()] : insertValsBase;

      const qMarks = insertVals.map(() => '?').join(', ');
      const [result] = await pool.query<any>(`INSERT INTO meal_plans (${insertCols}) VALUES (${qMarks})`, insertVals);
      const newId = (result as any)?.insertId || null;
      return res.status(201).json({ success: true, message: 'Meal plan saved', planId: newId });
    } catch (insertErr: any) {
      console.error('Insert meal plan failed:', getErrorMessage(insertErr));
      return res.status(500).json({ success: false, message: 'Failed to save meal plan', error: getErrorMessage(insertErr) });
    }
  } catch (err: any) {
    console.error('Save meal plan error:', getErrorMessage(err));
    return res.status(500).json({ success: false, message: 'Failed to save meal plan', error: getErrorMessage(err) });
  }
});

// ===== MEAL-PLANNER: List plans - schema-safe columns only =====
app.get('/api/meal-planner/plans', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const hasUpdatedAt = await dbColumnExists('meal_plans', 'updated_at');
    const hasGeneratedAt = await dbColumnExists('meal_plans', 'generated_at');

    const cols = ['id', 'plan_name', 'plan_data'];
    if (hasGeneratedAt) cols.push('generated_at');
    if (hasUpdatedAt) cols.push('updated_at');

    const orderBy = hasGeneratedAt ? 'generated_at' : 'id';
    const [rows] = await pool.query<any[]>(`SELECT ${cols.join(', ')} FROM meal_plans WHERE user_id = ? ORDER BY ${orderBy} DESC`, [userId]);

    const plans = rows.map((r: any) => ({
      id: Number(r.id),
      planName: r.plan_name ?? null,
      plan_data: typeof r.plan_data === 'string' ? (() => { try { return JSON.parse(r.plan_data); } catch { return r.plan_data; } })() : r.plan_data ?? null,
      generatedAt: r.generated_at ?? null,
      updatedAt: r.updated_at ?? r.generated_at ?? null
    }));

    res.json({ success: true, plans });
  } catch (err: any) {
    console.error('List meal plans endpoint error:', getErrorMessage(err));
    res.status(500).json({ success: false, message: 'Failed to list meal plans', error: getErrorMessage(err) });
  }
});

// ===== MEAL-PLANNER: Load plan by id - schema-safe =====
app.get('/api/meal-planner/plans/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const planId = Number(req.params.id);

    const hasUpdatedAt = await dbColumnExists('meal_plans', 'updated_at');
    const hasGeneratedAt = await dbColumnExists('meal_plans', 'generated_at');

    const cols = ['id', 'user_id', 'plan_name', 'plan_data'];
    if (hasGeneratedAt) cols.push('generated_at');
    if (hasUpdatedAt) cols.push('updated_at');

    const [rows] = await pool.query<any[]>(`SELECT ${cols.join(', ')} FROM meal_plans WHERE id = ?`, [planId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const plan = rows[0];
    if (Number(plan.user_id) !== userId && (req.user?.role ?? '') !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: not the owner' });
    }

    let parsed = null;
    if (typeof plan.plan_data === 'string') {
      try { parsed = JSON.parse(plan.plan_data); } catch { parsed = plan.plan_data; }
    } else {
      parsed = plan.plan_data;
    }

    res.json({
      success: true,
      plan: {
        id: plan.id,
        name: plan.plan_name,
        generatedAt: plan.generated_at ?? null,
        updatedAt: plan.updated_at ?? plan.generated_at ?? null,
        data: parsed,
      },
    });
  } catch (err: any) {
    console.error('Load meal plan error:', getErrorMessage(err));
    res.status(500).json({ success: false, message: 'Failed to load meal plan', error: getErrorMessage(err) });
  }
});

// ===== MEAL-PLANNER: Delete plan (owner or admin) - minimal columns, no updated_at =====
app.delete('/api/meal-planner/plans/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const planId = Number(req.params.id);

    // verify existence & owner (select minimal columns)
    const [rows] = await pool.query<any>('SELECT id, user_id FROM meal_plans WHERE id = ?', [planId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    const ownerId = Number(rows[0].user_id);
    const isOwner = ownerId === userId;
    const isAdmin = (req.user?.role || '') === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden: not the owner' });
    }

    await pool.query('DELETE FROM meal_plans WHERE id = ?', [planId]);
    console.log(`🗑️ User ${userId} deleted meal plan ${planId}`);
    return res.json({ success: true, message: 'Plan deleted' });
  } catch (err: any) {
    console.error('Delete meal plan error:', getErrorMessage(err));
    return res.status(500).json({ success: false, message: 'Failed to delete meal plan', error: getErrorMessage(err) });
  }
});

// QR Attendance Check-in Route
app.post('/api/attendance/checkin', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { qrToken, location } = req.body;

    // Validate QR token
    if (!qrToken || !qrToken.includes("ACTIVECORE_GYM")) {
      return res.status(400).json({ success: false, message: "Invalid QR code." });
    }

    // Prevent duplicate check-in for today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const [existing] = await pool.query<any[]>(
     
      `SELECT id FROM attendance WHERE user_id = ? AND DATE(check_in_time) = ?`,
      [userId, todayStr]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Already checked in today." });
    }

    // Insert attendance record
    await pool.query(
      `INSERT INTO attendance (user_id, check_in_time, location, status) VALUES (?, NOW(), ?, 'present')`,
      [userId, location || 'Main Gym']
    );

    res.json({
      success: true,
      message: "Check-in successful."
    });
  } catch (err: any) {
    console.error('❌ Attendance check-in error:', err);
    res.status(500).json({ success: false, message: "Failed to record attendance." });
  }
});

// Member Attendance History Route
app.get('/api/attendance/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [rows] = await pool.query<any[]>(
      `SELECT id, check_in_time, location, status FROM attendance WHERE user_id = ? ORDER BY check_in_time DESC`,
      [userId]
    );

    // Format for frontend
    const attendance = rows.map(r => {
      // Ensure check_in_time is a string in ISO format
      let checkInTimeStr: string;
      if (typeof r.check_in_time === 'string') {
        checkInTimeStr = r.check_in_time;
      } else if (r.check_in_time instanceof Date) {
        checkInTimeStr = r.check_in_time.toISOString();
      } else {
        checkInTimeStr = String(r.check_in_time);
      }
      return {
        id: r.id,
        checkInTime: checkInTimeStr,
        location: r.location,
        status: r.status,
        date: checkInTimeStr.split('T')[0],
        time: new Date(checkInTimeStr).toLocaleTimeString(),
      };
    });

    // Calculate stats
    let currentStreak = 0;
    let prevDate = null;
    for (const record of attendance) {
      const date = record.checkInTime.split('T')[0];
      if (!prevDate) {
        prevDate = date;
        currentStreak = 1;
      } else {
        const prev = new Date(prevDate);
        const curr = new Date(date);
        prev.setDate(prev.getDate() - 1);
        if (curr.toISOString().split('T')[0] === prev.toISOString().split('T')[0]) {
          currentStreak++;
          prevDate = date;
        } else {
          break;
        }
      }
    }

    res.json({
      success: true,
      attendance,
      stats: {
        totalAttendance: attendance.length,
        currentStreak
      }
    });
  } catch (err: any) {
    console.error('❌ Attendance history error:', err);
    res.status(500).json({ success: false, message: "Failed to fetch attendance history." });
  }
});

// Admin: Who is present today
app.get('/api/admin/attendance/today', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await pool.query<any[]>(
      `SELECT a.id, a.user_id, a.check_in_time, a.location, u.first_name, u.last_name, u.email
       FROM attendance a
       INNER JOIN users u ON a.user_id = u.id
       WHERE DATE(a.check_in_time) = ?
       ORDER BY a.check_in_time DESC`,
      [today]
    );
    res.json({ success: true, present: rows });
  } catch (err: any) {
    console.error('❌ Admin today attendance error:', err);
    res.status(500).json({ success: false, message: "Failed to fetch today's attendance." });
  }
});

app.get('/api/admin/attendance', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];
    const [rows] = await pool.query<any[]>(
      `SELECT a.id, a.user_id, a.check_in_time, a.location, u.first_name, u.last_name, u.email
       FROM attendance a
       INNER JOIN users u ON a.user_id = u.id
       WHERE DATE(a.check_in_time) = ?
       ORDER BY a.check_in_time DESC`,
      [date]
    );
    // Format for frontend
    const attendance = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      fullName: `${r.first_name} ${r.last_name}`,
      email: r.email,
      checkInTime: r.check_in_time,
      date: new Date(r.check_in_time).toLocaleDateString(),
      time: new Date(r.check_in_time).toLocaleTimeString(),
      location: r.location,
      status: "present"
    }));
    res.json({ success: true, attendance });
  } catch (err: any) {
    console.error('❌ Admin attendance error:', err);
    res.status(500).json({ success: false, message: "Failed to fetch attendance." });
  }
});

// --- Rewards: Available ---
app.get('/api/rewards/available', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    // Example rewards (customize as needed)
    const rewards = [
      { id: 1, title: "Bronze Streak", description: "Attend 3 days", requiredAttendance: 3, points: 10, category: "streak", icon: "🥉" },
      { id: 2, title: "Silver Streak", description: "Attend 7 days", requiredAttendance: 7, points: 25, category: "streak", icon: "🥈" },
      { id: 3, title: "Gold Streak", description: "Attend 14 days", requiredAttendance: 14, points: 50, category: "streak", icon: "🥇" },
      { id: 4, title: "Attendance Pro", description: "Attend 30 days", requiredAttendance: 30, points: 100, category: "streak", icon: "🏆" },
    ];

    // Fetch claimed rewards
    const [claimedRows] = await pool.query<any[]>(
      `SELECT reward_id, claimed_at FROM rewards_claimed WHERE user_id = ?`,
      [userId]
    );
    const claimedMap = new Map<number, string>();
    claimedRows.forEach(r => claimedMap.set(r.reward_id, r.claimed_at));

    // Fetch attendance count
    const [attendanceRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM attendance WHERE user_id = ?`,
      [userId]
    );
    const totalAttendance = attendanceRows[0]?.total || 0;

    // Mark rewards as claimed/unlocked
    const rewardsWithStatus = rewards.map(r => ({
      ...r,
      claimed: claimedMap.has(r.id),
      claimedAt: claimedMap.get(r.id) || null,
      unlocked: totalAttendance >= r.requiredAttendance
    }));

    res.json({ success: true, rewards: rewardsWithStatus });
  } catch (err: any) {
    console.error('❌ Rewards available error:', err);
    res.status(500).json({ success: false, message: "Failed to fetch rewards." });
  }
});

// --- Rewards: Claim ---
app.post('/api/rewards/claim', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { rewardId } = req.body;
    if (!rewardId) return res.status(400).json({ success: false, message: "Missing rewardId" });

    // Example rewards (should match above)
    const rewards = [
      { id: 1, requiredAttendance: 3 },
      { id: 2, requiredAttendance: 7 },
      { id: 3, requiredAttendance: 14 },
      { id: 4, requiredAttendance: 30 },
    ];
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return res.status(404).json({ success: false, message: "Reward not found" });

    // Check attendance
    const [attendanceRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM attendance WHERE user_id = ?`,
      [userId]
    );
    const totalAttendance = attendanceRows[0]?.total || 0;
    if (totalAttendance < reward.requiredAttendance) {
      return res.status(400).json({ success: false, message: "Not enough attendance to claim this reward." });
    }

    // Check if already claimed
    const [claimedRows] = await pool.query<any[]>(
      `SELECT id FROM rewards_claimed WHERE user_id = ? AND reward_id = ?`,
      [userId, rewardId]
    );
    if (claimedRows.length > 0) {
      return res.status(400).json({ success: false, message: "Reward already claimed." });
    }

    // Insert claim
    await pool.query(
      `INSERT INTO rewards_claimed (user_id, reward_id, claimed_at) VALUES (?, ?, NOW())`,
      [userId, rewardId]
    );

    res.json({ success: true, message: "Reward claimed!" });
  } catch (err: any) {
    console.error('❌ Claim reward error:', err);
    res.status(500).json({ success: false, message: "Failed to claim reward." });
  }
});

// User Profile Route (for QR Attendance)
app.get('/api/user/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [users] = await pool.query<any[]>(
      'SELECT id, email, first_name, last_name, role FROM users WHERE id = ?',
      [userId]
    );
    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const user = users[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('❌ User profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user profile.' });
  }
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Express error:', getErrorMessage(err));
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err: any) => {
  console.error('UNCAUGHT EXCEPTION:', getErrorMessage(err), err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('UNHANDLED REJECTION:', getErrorMessage(reason), reason);
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3002;

let dbConnected = false;

console.log(`\n🔰 Activecore Backend starting (NODE_ENV=${process.env.NODE_ENV})`);
console.log('🔍 Env vars sample:', {
  DB_HOST: process.env.DB_HOST || 'not set',
  DB_PORT: process.env.DB_PORT || 'not set',
  DB_NAME: process.env.DB_NAME || 'not set',
  API_PORT: process.env.PORT || 3002,
  FRONTEND_URL: process.env.FRONTEND_URL || 'not set',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'not set',
});

app.get('/api/ping', (req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

async function startServer() {
  console.log('\n🚀 Starting server...');
  try {
    try {
      dbConnected = await initializeDatabase();
      console.log('✅ Database init finished. Connected:', !!dbConnected);
    } catch (dbErr: any) {
      dbConnected = false;
      console.error('❌ Database initialization failed:', getErrorMessage(dbErr)); // changed
      console.warn('⚠️ Server will continue listening — DB queries will fallback where implemented.');
    }

    const portNum = Number(process.env.PORT || PORT || 3002);
    app.listen(portNum, () => {
      console.log('=========================================');
      console.log(`🌐 Server running on port ${portNum}`);
      console.log(`🌐 API URL: http://localhost:${portNum}`);
      console.log('=========================================');
    }).on('error', (err: any) => {
      console.error('❌ App listen error:', getErrorMessage(err));
      process.exit(1);
    });
  } catch (err: any) {
    console.error('Fatal server start error:', getErrorMessage(err));
    process.exit(1);
  }
}

app.get('/', (req: Request, res: Response) => {
  res.send('Activecore Backend: running');
});

startServer();

// QR Token Generation for Attendance (Admin)
app.post('/api/admin/qr-token/generate', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // You can make this more secure by encoding gym, date, and expiry
    const { expiresInHours = 24 } = req.body;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
    // Example token: ACTIVECORE_GYM_YYYYMMDDHHMMSS_random
    const token = `ACTIVECORE_GYM_${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    res.json({
      success: true,
      token,
      expiresAt: expiresAt.toISOString()
    });
  } catch (err: any) {
    console.error('❌ QR token generation error:', err);
    res.status(500).json({ success: false, message: "Failed to generate QR token." });
  }
});

// Ensure this runs after pool and env are ready
(async function ensureNotificationTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT NOW(),
        INDEX (user_id),
        INDEX (type)
      )
    `);
    console.log('✅ notification_logs table ready');
  } catch (err) {
    console.error('Failed to create notification_logs table', err);
  }
})();

// Setup email transporter
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromEmail = process.env.FROM_EMAIL || smtpUser;

// typed transporter so it isn't implicitly `any`
let transporter: Transporter | undefined;
let smtpReady = false;

if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  transporter
    .verify()
    .then(() => {
      smtpReady = true;
      console.log('✅ SMTP ready');
    })
    .catch((err: any) => {
      smtpReady = false;
      console.warn('SMTP verify failed', err);
    });
} else {
  console.warn(
    '⚠️ SMTP config missing. Reminder emails will not be sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env'
  );
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!transporter) {
    console.warn('No transporter configured; skipping sendEmail to', to);
    return false;
  }
  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to,
      subject,
      html,
    });
    console.log(`✉️ Sent email to ${to}: ${info.messageId}`);
    return true;
  } catch (err: any) {
    console.error(`Failed to send email to ${to}:`, err.message || err);
    return false;
  }
}

function isValidEmail(email?: string) {
  if (!email || typeof email !== 'string') return false;
  // simple regex — avoids outbound errors caused by malformed addresses
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function notifyInactiveMembers(thresholdDays = 3) {
  try {
    if (!transporter || !smtpReady) {
      console.warn('SMTP not configured or not ready — skipping notifyInactiveMembers');
      return { success: false, message: 'SMTP not configured or credentials invalid' };
    }

    // Select members who haven't checked in within thresholdDays
    const [rows] = await pool.query<any[]>(
      `
      SELECT u.id, u.email, u.first_name, u.last_name, MAX(a.check_in_time) AS lastCheckIn
      FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id
      WHERE u.role = 'member' AND u.status = 'active'
      GROUP BY u.id
      HAVING (lastCheckIn IS NULL OR DATE(lastCheckIn) <= DATE_SUB(CURDATE(), INTERVAL ? DAY))
      `,
      [thresholdDays]
    );

    if (!rows || rows.length === 0) {
      console.log(`No inactive members found for thresholdDays=${thresholdDays}`);
      return { success: true, notified: 0 };
    }

    console.log(`Found ${rows.length} inactive members; processing email reminders...`);
    let notifiedCount = 0;

    for (const u of rows) {
      if (!u.email || !isValidEmail(u.email)) {
        console.warn('Skipping invalid or missing email for user', u.id, u.email);
        continue;
      }

      // Avoid resending within last thresholdDays
      const [alreadySent] = await pool.query<any[]>(
        `SELECT id FROM notification_logs WHERE user_id = ? AND type = 'absent_reminder' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 1`,
        [u.id, thresholdDays]
      );

      if (alreadySent.length > 0) {
        console.log(`Already notified user ${u.id} in last ${thresholdDays} days — skip`);
        continue;
      }

      const lastCheckInText = u.lastCheckIn ? `Your last visit was on ${new Date(u.lastCheckIn).toLocaleDateString()}.` : `We haven't seen you yet — start your journey with us!`;

      const subject = `We've missed you at ActiveCore — come back!`;
      const html = `
        <p>Hi ${u.first_name || 'Member'},</p>
        <p>${lastCheckInText}</p>
        <p>We noticed you haven't visited the gym in a while. Your fitness matters — we'd love to see you back! Here are a few ways to make it easier:</p>
        <ul>
          <li>Book a quick orientation with our trainer</li>
          <li>Try a refreshed workout plan</li>
          <li>Bring a friend and get motivated together</li>
        </ul>
        <p>If there's anything we can help with, just reply to this email.</p>
        <p>— ActiveCore</p>
      `;

      const sent = await sendEmail(u.email, subject, html);
      if (sent) {
        await pool.query(`INSERT INTO notification_logs (user_id, type, created_at) VALUES (?, 'absent_reminder', NOW())`, [u.id]);
        notifiedCount++;
      } else {
        console.warn('Failed to send reminder to', u.email);
      }
    }

    console.log(`Done: ${notifiedCount} reminder(s) sent`);
    return { success: true, notified: notifiedCount };
  } catch (err: any) {
    console.error('notifyInactiveMembers error', err);
    return { success: false, error: err.message || err };
  }
}

// Admin endpoint: trigger notifications manually
app.post('/api/admin/attendance/notify-inactive', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { thresholdDays = 3 } = req.body;
    const result = await notifyInactiveMembers(Number(thresholdDays));
    res.json(result);
  } catch (err: any) {
    console.error('❌ notify-inactive endpoint error:', err);
    res.status(500).json({ success: false, message: 'Failed to notify inactive members' });
  }
});

// Schedule daily run (once every 24h) at server start if desired
const NOTIFY_THRESHOLD_DAYS = Number(process.env.INACTIVE_NOTIFY_DAYS) || 3;
const DAILY_MS = 24 * 60 * 60 * 1000;
// Run once at startup
setTimeout(() => {
  notifyInactiveMembers(NOTIFY_THRESHOLD_DAYS).catch(err => console.error('Scheduled notify failed', err));
}, 5 * 1000); // small delay on start
// Run every 24 hours
setInterval(() => {
  notifyInactiveMembers(NOTIFY_THRESHOLD_DAYS).catch(err => console.error('Scheduled notify failed', err));
}, DAILY_MS);

// Admin endpoint: test sending email
app.post('/api/admin/attendance/test-email', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ success: false, message: 'Missing "to" address in body' });
    }
    const subject = 'ActiveCore test email';
    const html = `<p>This is a test message from <strong>ActiveCore</strong>. If you received this, SMTP settings are valid.</p>`;
    const sent = await sendEmail(to, subject, html);
    if (!sent) {
      return res.status(500).json({ success: false, message: 'Failed to send test email. Check SMTP settings and logs.' });
    }
    res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err: any) {
    console.error('❌ Test email endpoint error:', getErrorMessage(err));
    res.status(500).json({ success: false, message: 'Failed to send test email.' });
  }
});

// Add PayMongo webhook secret + public key + app base url
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';
const PAYMONGO_PUBLIC_KEY = process.env.PAYMONGO_PUBLIC_KEY || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Basic auth header helper for PayMongo
const paymongoAuthHeader = () => `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`;

// Create a PayMongo 'gcash' source and return redirect URL
app.post('/api/payments/paymongo/create-source', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { amount, plan, successRedirect, failedRedirect } = req.body;

    if (!amount || !plan) {
      return res.status(400).json({ success: false, message: 'Missing amount or plan' });
    }

    const payload = {
      data: {
        attributes: {
          amount: Math.round(Number(amount) * 100), // PayMongo uses centavos
          currency: 'PHP',
          type: 'gcash',
          redirect: {
            success: (successRedirect || `${APP_URL}/payment/success`) + '?sourceId={id}',
            failed: (failedRedirect || `${APP_URL}/payment/failed`) + '?sourceId={id}',
          },
          metadata: { userId, plan }
        }
      }
    };

    const response = await axios.post(`${PAYMONGO_BASE_URL}/sources`, payload, {
       headers: {
         Authorization: paymongoAuthHeader(),
         'Content-Type': 'application/json'
       }
    });
    // keep response typing simple to avoid axios type issues
    const responseData = (response as any).data;

    const source = responseData?.data;
    if (!source) return res.status(500).json({ success: false, message: 'Could not create source' });

    const checkoutUrl = source.attributes?.redirect?.checkout_url;
    const sourceId = source.id;

    // Insert payment record (pending)
    await pool.query(
      `INSERT INTO payments (user_id, amount, payment_method, membership_type, payment_status, transaction_id, created_at)
         VALUES (?, ?, 'gcash', ?, 'pending', ?, NOW())`,
      [userId, Number(amount), plan, sourceId]
    );

    res.json({ success: true, checkoutUrl, sourceId });
  } catch (err: any) {
    console.error('❌ create-source error', err.response?.data || err.message || err);
    res.status(500).json({ success: false, message: 'Create source failed' });
  }
});

// PayMongo webhook - verify signature and update DB
app.post('/api/payments/paymongo/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body; // Buffer
    const signatureHeader = (req.headers['paymongo-signature'] as string) || (req.headers['x-paymongo-signature'] as string) || '';

    // Verify signature if configured
    if (PAYMONGO_WEBHOOK_SECRET) {
      const computed = crypto.createHmac('sha256', PAYMONGO_WEBHOOK_SECRET).update(rawBody).digest('hex');
      // PayMongo signature header often contains 'sha256=<hash>' or a CSV with various algorithms
      const signatureValue = signatureHeader.split(/\s*,\s*/).find((s) => s.includes('sha256='))?.split('=')[1];
      if (!signatureValue || signatureValue !== computed) {
        console.warn('⚠️ Invalid PayMongo webhook signature');
        return res.status(400).send('Invalid signature');
      }
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const eventType = event.type;
    console.log('🔔 PayMongo webhook received:', eventType);

    const sourceId = event.data?.attributes?.source?.id || event.data?.id || event.data?.attributes?.source;
    const paymentId = event.data?.id || event.data?.attributes?.payment;

    if (!sourceId && !paymentId) {
      console.warn('⚠️ Webhook missing source/payment id');
      return res.json({ success: true });
    }

    const [rows] = await pool.query<any[]>(
      `SELECT id, user_id, amount, membership_type FROM payments WHERE transaction_id IN (?, ?) LIMIT 1`,
      [sourceId, paymentId]
    );

    if (!rows || rows.length === 0) {
      console.warn('⚠️ No matching payment record found for source/payment', sourceId || paymentId);
      return res.json({ success: true });
    }

    const record = rows[0];
    let newStatus = 'pending';
    if (eventType === 'payment.paid' || eventType === 'source.chargeable') newStatus = 'completed';
    if (eventType === 'payment.failed') newStatus = 'failed';

    await pool.query(
      `UPDATE payments SET payment_status = ?, transaction_id = ?, payment_date = NOW() WHERE id = ?`,
      [newStatus, paymentId || sourceId, record.id]
    );

    if (newStatus === 'completed') {
      let months = 1;
      const plan = record.membership_type || '';
      if (/year/i.test(plan)) months = 12;
      if (/quarter/i.test(plan)) months = 3;

      await pool.query(
        `UPDATE users SET next_payment = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE id = ?`,
        [months, record.user_id]
      );

      await pool.query(
        `INSERT INTO payments_history (user_id, payment_id, amount, payment_method, status, created_at)
           VALUES (?, ?, ?, 'gcash', 'completed', NOW())`,
        [record.user_id, record.id, record.amount]
      );
      console.log(`✅ Payment for user ${record.user_id} marked as completed (source/payment=${sourceId || paymentId})`);
    } else {
      console.log(`ℹ️ Payment status updated to ${newStatus} for source/payment ${sourceId || paymentId}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('❌ PayMongo webhook error', err.message || err);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

// Verify endpoint — read DB payment status by source or payment id
app.get('/api/payments/paymongo/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sourceId = (req.query.sourceId as string) || (req.query.paymentId as string);
    if (!sourceId) return res.status(400).json({ success: false, message: 'Missing sourceId or paymentId' });

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM payments WHERE transaction_id = ? LIMIT 1`,
      [sourceId]
    );

    if (!rows || rows.length === 0) {
      return res.json({ success: true, status: 'pending', message: 'No payment found yet.' });
    }
    const p = rows[0];
    return res.json({ success: true, status: p.payment_status, payment: p });
  } catch (err: any) {
    console.error('❌ verify payment error', err);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
});