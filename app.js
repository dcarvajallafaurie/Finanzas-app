import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

// --- VARIABLES GLOBALES Y ESTADO ---
let budgets = [], transactions = [], wealth = [], creditCards = [], ccTransactions = [];
let activeFormType = null, editingId = null, currentUser = null;
let currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let TRM = 3900; // Valor por defecto
let myChart = null;

const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud", "Otras categorías"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense", "Otras categorías": "expense",
        "Emergencia": "expense", // Especial: Resta del Fondo de Emergencia
        "Pago Tarjeta": "expense" // Especial: Restaura el cupo de la tarjeta
    },
    wealthIcons: [
        { name: "Fondo de Emergencia", icon: "shield" },
        { name: "CDT", icon: "lock" },
        { name: "Ahorro Programado", icon: "piggy-bank" },
        { name: "Finca Raíz", icon: "home" },
        { name: "Acciones / Inversión", icon: "trending-up" },
        { name: "Otro Activo", icon: "briefcase" }
    ]
};

// --- INICIALIZACIÓN Y API DE DÓLARES ---
document.getElementById("month-selector").value = currentMonth;
document.getElementById("month-selector").addEventListener("change", (e) => {
    currentMonth = e.target.value;
    actualizarDatosUI();
});

// Obtener TRM real al cargar
fetch('https://open.er-api.com/v6/latest/USD')
    .then(res => res.json())
    .then(data => {
        TRM = data.rates.COP;
        document.getElementById("trm-display").textContent = `$${TRM.toFixed(0)} COP`;
    }).catch(e => console.log("Error TRM, usando defecto"));

// Tema Claro / Oscuro
document.getElementById("btnThemeToggle").addEventListener("click", () => {
    document.body.classList.toggle("light-mode");
});

function formatMoney(amount) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount); }

// --- AUTH Y CAPTCHA ---
let captchaCorrect = 0;
document.getElementById("btnRegister").addEventListener("click", () => {
    document.getElementById("btnLogin").style.display = "none";
    document.getElementById("btnRegister").style.display = "none";
    document.getElementById("btnSubmitRegister").style.display = "block";
    document.getElementById("btnBackToLogin").style.display = "block";
    document.getElementById("register-fields").style.display = "block";
    document.getElementById("captcha-container").style.display = "block";
    let n1 = Math.floor(Math.random()*10)+1, n2 = Math.floor(Math.random()*10)+1;
    captchaCorrect = n1 + n2;
    document.getElementById("captcha-question").textContent = `${n1} + ${n2} =`;
});
document.getElementById("btnBackToLogin").addEventListener("click", () => window.location.reload());

document.getElementById("btnSubmitRegister").addEventListener("click", async () => {
    const nombre = document.getElementById("nombre").value, apellido = document.getElementById("apellido").value;
    const email = document.getElementById("email").value, password = document.getElementById("password").value;
    if (parseInt(document.getElementById("captcha-answer").value) !== captchaCorrect) return alert("Captcha incorrecto");
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: `${nombre} ${apellido}` });
        // Crear tarjeta de crédito por defecto al registrar
        await addDoc(collection(db, "creditCards"), { userId: cred.user.uid, limit: 2000000, debt: 0, createdAt: Date.now() });
    } catch (e) { alert(e.message); }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Datos incorrectos"); }
});
document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-panel").style.display = "none";
        document.getElementById("dashboard-panel").style.display = "flex";
        document.getElementById("user-display").textContent = user.displayName || user.email.split('@')[0];
        cargarDatos();
        window.showView('home'); 
    } else {
        document.getElementById("auth-panel").style.display = "block";
        document.getElementById("dashboard-panel").style.display = "none";
    }
});

// --- LECTURA BASE DE DATOS ---
function cargarDatos() {
    const q = (col) => query(collection(db, col), where("userId", "==", currentUser.uid));
    onSnapshot(q("transactions"), snap => { transactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("budgets"), snap => { budgets = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("wealth"), snap => { wealth = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("creditCards"), snap => { creditCards = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("ccTransactions"), snap => { ccTransactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
}

window.showView = (v) => {
    document.querySelectorAll('.view-container, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${v}`).classList.add('active');
    const idx = {'home':0, 'budgets':1, 'credit':2, 'wealth':3};
    document.querySelectorAll('.nav-item')[idx[v]].classList.add('active');
    actualizarDatosUI();
};

// --- CÁLCULOS Y RENDERIZADO (MES DINÁMICO Y ROLLOVER) ---
function actualizarDatosUI() {
    // 1. Filtrar Movimientos del Mes Actual
    const currentMonthTrans = transactions.filter(t => t.month === currentMonth);
    let incMonth = currentMonthTrans.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expMonth = currentMonthTrans.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
    // 2. Rollover (Excedente de meses pasados)
    const pastTrans = transactions.filter(t => t.month < currentMonth);
    const pastInc = pastTrans.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const pastExp = pastTrans.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const rollover = pastInc - pastExp;
    
    if (rollover > 0) {
        incMonth += rollover; // El excedente actúa como ingreso este mes
        document.getElementById("rollover-indicator").textContent = `Saldo Disponible (Incluye +${formatMoney(rollover)} de meses pasados)`;
    } else {
        document.getElementById("rollover-indicator").textContent = "Saldo Total Disponible";
    }

    document.getElementById("total-income").textContent = `+${formatMoney(incMonth)}`;
    document.getElementById("total-expense").textContent = `-${formatMoney(expMonth)}`;
    document.getElementById("total-balance").textContent = formatMoney(incMonth - expMonth);

    // 3. Tablero
    const cList = document.getElementById("transaction-list");
    cList.innerHTML = '';
    currentMonthTrans.sort((a,b)=>b.createdAt - a.createdAt).forEach(t => {
        let isInc = t.type === 'income';
        cList.innerHTML += `<div class="item-card"><div class="item-left"><div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description}</p></div></div><div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatMoney(t.amount)}</div></div>`;
    });

    // 4. Presupuestos (Calculado solo con gastos del mes)
    const bList = document.getElementById("budget-list");
    bList.innerHTML = '';
    budgets.forEach(b => {
        const spent = currentMonthTrans.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        let pct = Math.min((spent / b.amount) * 100, 100);
        let color = pct >= 90 ? 'danger' : (pct >= 70 ? 'warning' : '');
        bList.innerHTML += `<div class="item-card budget-card"><div class="budget-header"><div class="item-left"><div class="item-icon"><i data-lucide="target"></i></div><div class="item-info"><h5>${b.category}</h5></div></div><div style="font-weight:600;">Límite: ${formatMoney(b.amount)}</div></div><div class="budget-progress-container"><div class="budget-progress-fill ${color}" style="width: ${pct}%;"></div></div><div class="budget-stats"><span>Gastado: ${formatMoney(spent)}</span><span>Restante: ${formatMoney(b.amount - spent)}</span></div></div>`;
    });

    // 5. Patrimonio
    document.getElementById("total-wealth-value").textContent = formatMoney(wealth.reduce((s, w) => s + w.amount, 0));
    const wList = document.getElementById("wealth-list");
    wList.innerHTML = '';
    wealth.forEach(w => {
        wList.innerHTML += `<div class="item-card" onclick="openEditForm('wealth', '${w.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${w.icon}"></i></div><div class="item-info"><h5>${w.name}</h5></div></div><div style="font-weight:600;">${formatMoney(w.amount)}</div></div>`;
    });

    // 6. Tarjeta de Crédito
    if(creditCards.length > 0) {
        let cc = creditCards[0];
        let debt = ccTransactions.filter(t=> t.month === currentMonth).reduce((s,t)=> s + t.amount, 0); // Gastos TC del mes
        document.getElementById("cc-debt").textContent = formatMoney(debt);
        document.getElementById("cc-available").textContent = formatMoney(cc.limit - debt);
        
        const ccList = document.getElementById("cc-transactions-list");
        ccList.innerHTML = '';
        ccTransactions.filter(t=> t.month === currentMonth).forEach(t => {
            ccList.innerHTML += `<div class="item-card"><div class="item-left"><div class="item-icon"><i data-lucide="shopping-bag"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description}</p></div></div><div class="val-expense">-${formatMoney(t.amount)}</div></div>`;
        });
    }

    lucide.createIcons();
}

// --- FORMULARIOS ---
window.toggleForm = (type = null) => {
    activeFormType = type;
    if (!type) return document.getElementById("modal-form").classList.remove('active');
    
    document.getElementById("modal-form").classList.add('active');
    const fields = document.getElementById("form-fields");
    
    if (type === 'transaction') {
        fields.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${Object.keys(CATEGORIES.transaction).map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Valor ($)"><input type="text" id="f-desc" class="glass-input" placeholder="Descripción">`;
    } else if (type === 'wealth') {
        fields.innerHTML = `<select id="f-type" class="glass-input"><option value="" disabled selected>Tipo</option>${CATEGORIES.wealthIcons.map(w=>`<option value="${w.name}|${w.icon}">${w.name}</option>`).join('')}</select><input type="text" id="f-desc" class="glass-input" placeholder="Nombre"><div style="display:flex; gap:10px;"><input type="number" id="f-amount" class="glass-input" placeholder="Monto"><div style="margin-top:15px; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="f-usd"> <label style="font-size:12px;">Es USD</label></div></div><p style="font-size:11px; opacity:0.7; margin-top:5px;">Si es USD, se multiplicará por el TRM actual.</p>`;
    } else if (type === 'budget') {
        fields.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${CATEGORIES.budget.map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Límite Mensual ($)">`;
    } else if (type === 'cc-transaction') {
        fields.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría de Gasto</option>${CATEGORIES.budget.map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Valor gastado con TC ($)"><input type="text" id="f-desc" class="glass-input" placeholder="Descripción">`;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id;
    document.getElementById("btnDeleteForm").style.display = 'block';
    let item = wealth.find(i => i.id === id); // Solo permitimos editar wealth por simplicidad
    if(item) {
        document.getElementById("f-type").value = `${item.name}|${item.icon}`;
        document.getElementById("f-amount").value = item.amount;
        document.getElementById("f-desc").value = item.description || "";
    }
};

// --- GUARDAR CON LÓGICA INTELIGENTE (Contabilidad Partida Doble) ---
document.getElementById("btnSubmitForm").addEventListener("click", async () => {
    if (!activeFormType) return;
    document.getElementById("btnSubmitForm").disabled = true;

    let data = { userId: currentUser.uid, createdAt: Date.now() };

    if (activeFormType === 'wealth') {
        let amt = parseFloat(document.getElementById("f-amount").value);
        if(document.getElementById("f-usd").checked) amt = amt * TRM; // Conversión a COP
        
        const [name, icon] = document.getElementById("f-type").value.split('|');
        data = { ...data, name, icon, amount: amt, description: document.getElementById("f-desc").value };
        if(editingId) await updateDoc(doc(db, "wealth", editingId), data);
        else await addDoc(collection(db, "wealth"), data);

    } else if (activeFormType === 'transaction') {
        const cat = document.getElementById("f-cat").value;
        const amt = parseFloat(document.getElementById("f-amount").value);
        data = { ...data, category: cat, amount: amt, type: CATEGORIES.transaction[cat], description: document.getElementById("f-desc").value, month: currentMonth };
        
        // Lógica: Restar de Fondo de Emergencia
        if (cat === "Emergencia") {
            let fondo = wealth.find(w => w.name === "Fondo de Emergencia");
            if (fondo) await updateDoc(doc(db, "wealth", fondo.id), { amount: fondo.amount - amt });
        }
        // Lógica: Pago de Tarjeta de Crédito (Resta deuda)
        if (cat === "Pago Tarjeta" && creditCards.length > 0) {
            let cc = creditCards[0];
            await updateDoc(doc(db, "creditCards", cc.id), { debt: Math.max(0, cc.debt - amt) });
        }
        await addDoc(collection(db, "transactions"), data);

    } else if (activeFormType === 'cc-transaction') {
        // Gasto con TC no afecta el saldo principal, va a ccTransactions
        data = { ...data, category: document.getElementById("f-cat").value, amount: parseFloat(document.getElementById("f-amount").value), description: document.getElementById("f-desc").value, month: currentMonth };
        await addDoc(collection(db, "ccTransactions"), data);
        if(creditCards.length > 0) await updateDoc(doc(db, "creditCards", creditCards[0].id), { debt: creditCards[0].debt + data.amount });
    } else if (activeFormType === 'budget') {
        data = { ...data, category: document.getElementById("f-cat").value, amount: parseFloat(document.getElementById("f-amount").value) };
        await addDoc(collection(db, "budgets"), data);
    }
    
    window.toggleForm();
    document.getElementById("btnSubmitForm").disabled = false;
});

// --- ELIMINAR ---
document.getElementById("btnDeleteForm").addEventListener("click", async () => {
    if(editingId) await deleteDoc(doc(db, "wealth", editingId));
    window.toggleForm();
});

// --- GRÁFICOS (CHART.JS) ---
window.openChartModal = () => {
    document.getElementById("modal-chart").classList.add('active');
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    
    // Sumar gastos por categoría del mes actual
    let expByCategory = {};
    transactions.filter(t => t.type === 'expense' && t.month === currentMonth).forEach(t => {
        expByCategory[t.category] = (expByCategory[t.category] || 0) + t.amount;
    });

    if(myChart) myChart.destroy();
    
    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(expByCategory),
            datasets: [{
                data: Object.values(expByCategory),
                backgroundColor: ['#ef4444', '#f97316', '#eab308', '#84cc16', '#06b6d4', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-main)' } } } }
    });
};