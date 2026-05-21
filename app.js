import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

// Variables UI
const authPanel = document.getElementById("auth-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const modalForm = document.getElementById("modal-form");
const formTitle = document.getElementById("form-title");
const formFields = document.getElementById("form-fields");
const btnSubmitForm = document.getElementById("btnSubmitForm");
const btnDeleteForm = document.getElementById("btnDeleteForm");
const errorMsg = document.getElementById("error-message");

// Elementos del Registro Nuevo
const btnLogin = document.getElementById("btnLogin");
const btnRegister = document.getElementById("btnRegister");
const btnSubmitRegister = document.getElementById("btnSubmitRegister");
const btnBackToLogin = document.getElementById("btnBackToLogin");
const registerFields = document.getElementById("register-fields");
const captchaContainer = document.getElementById("captcha-container");
const captchaQuestion = document.getElementById("captcha-question");
let captchaCorrectAnswer = 0;

// Estado Global
let budgets = [];
let transactions = [];
let wealth = [];
let activeFormType = null; 
let editingId = null;
let currentUser = null;

// Diccionario de Categorías Actualizado (Incluye 'Otras categorías')
const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud", "Otras categorías"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense", "Otras categorías": "expense"
    },
    // Selector de Iconos para Portafolio (Bolsillos)
    wealthIcons: [
        { name: "Fondo de Emergencia", icon: "shield" },
        { name: "CDT", icon: "lock" },
        { name: "Ahorro Programado", icon: "piggy-bank" },
        { name: "Finca Raíz", icon: "home" },
        { name: "Acciones / Inversión", icon: "trending-up" },
        { name: "Otro Activo", icon: "briefcase" }
    ]
};

function formatMoney(amount) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount); }
function showError(msg) { errorMsg.textContent = msg; errorMsg.style.display = "block"; }

// --- LÓGICA DE REGISTRO CON CAPTCHA ---
function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    captchaCorrectAnswer = num1 + num2;
    captchaQuestion.textContent = `${num1} + ${num2} =`;
    document.getElementById("captcha-answer").value = "";
}

btnRegister.addEventListener("click", () => {
    // Cambiar vista a modo registro
    btnLogin.style.display = "none";
    btnRegister.style.display = "none";
    btnSubmitRegister.style.display = "block";
    btnBackToLogin.style.display = "block";
    registerFields.style.display = "block";
    captchaContainer.style.display = "block";
    generateCaptcha();
});

btnBackToLogin.addEventListener("click", () => {
    // Volver a modo login
    btnLogin.style.display = "block";
    btnRegister.style.display = "block";
    btnSubmitRegister.style.display = "none";
    btnBackToLogin.style.display = "none";
    registerFields.style.display = "none";
    captchaContainer.style.display = "none";
    errorMsg.style.display = "none";
});

btnSubmitRegister.addEventListener("click", async () => {
    const nombre = document.getElementById("nombre").value.trim();
    const apellido = document.getElementById("apellido").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const captchaVal = parseInt(document.getElementById("captcha-answer").value);

    if (!nombre || !apellido || !email || !password) return showError("Completa todos los campos.");
    if (captchaVal !== captchaCorrectAnswer) return showError("Respuesta de seguridad incorrecta.");

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // Guardar Nombre y Apellido en el perfil de Firebase
        await updateProfile(userCred.user, { displayName: `${nombre} ${apellido}` });
    } catch (e) { showError(e.message); }
});

btnLogin.addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { showError("Correo o contraseña incorrectos"); }
});

document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

// --- CONTROL DE SESIÓN ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authPanel.style.display = "none";
        dashboardPanel.style.display = "flex";
        // Mostrar el nombre real (o el correo si no tiene nombre configurado)
        document.getElementById("user-display").textContent = user.displayName || user.email.split('@')[0];
        cargarDatosAislados(); // Carga SOLO los datos de este usuario
        window.showView('home'); 
    } else {
        currentUser = null;
        authPanel.style.display = "block";
        dashboardPanel.style.display = "none";
    }
});

// --- LECTURA AISLADA EN TIEMPO REAL ---
function cargarDatosAislados() {
    if (!currentUser) return;

    // MAGIA: El "where" filtra para que solo traiga los datos creados por este usuario
    const qTrans = query(collection(db, "transactions"), where("userId", "==", currentUser.uid));
    onSnapshot(qTrans, (snapshot) => {
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.createdAt - a.createdAt);
        actualizarDatosUI();
    });

    const qBudgets = query(collection(db, "budgets"), where("userId", "==", currentUser.uid));
    onSnapshot(qBudgets, (snapshot) => {
        budgets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        actualizarDatosUI();
    });

    const qWealth = query(collection(db, "wealth"), where("userId", "==", currentUser.uid));
    onSnapshot(qWealth, (snapshot) => {
        wealth = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        actualizarDatosUI();
    });
}

// --- ACTUALIZACIÓN VISUAL ---
window.showView = (viewName) => {
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    const navItems = { 'home': 0, 'budgets': 1, 'wealth': 2 };
    document.querySelectorAll('.nav-item')[navItems[viewName]].classList.add('active');
    actualizarDatosUI();
};

function actualizarDatosUI() {
    const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    
    document.getElementById("total-income").textContent = `+${formatMoney(income)}`;
    document.getElementById("total-expense").textContent = `-${formatMoney(expense)}`;
    document.getElementById("total-balance").textContent = formatMoney(income - expense);
    document.getElementById("total-wealth-value").textContent = formatMoney(wealth.reduce((sum, w) => sum + w.amount, 0));

    renderTransactions();
    renderBudgets();
    renderWealth();
    lucide.createIcons();
}

// --- RENDERIZADO ESPECÍFICO ---
function renderTransactions() {
    const container = document.getElementById("transaction-list");
    container.innerHTML = transactions.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">No hay registros aún.</p>`;
    transactions.forEach(item => {
        let isIncome = item.type === 'income';
        container.innerHTML += `
            <div class="item-card" onclick="openEditForm('transaction', '${item.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${isIncome ? 'arrow-down-left' : 'arrow-up-right'}"></i></div>
                    <div class="item-info">
                        <h5>${item.category}</h5>
                        <p>${item.description || 'Detalle'}</p>
                    </div>
                </div>
                <div class="${isIncome ? 'val-income' : 'val-expense'}">${isIncome ? '+' : '-'}${formatMoney(item.amount)}</div>
            </div>
        `;
    });
}

function renderBudgets() {
    const container = document.getElementById("budget-list");
    container.innerHTML = budgets.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">No tienes presupuestos activos.</p>`;
    
    budgets.forEach(item => {
        // Calcular cuánto se ha gastado de esta categoría sumando las transacciones
        const spent = transactions.filter(t => t.type === 'expense' && t.category === item.category).reduce((sum, t) => sum + t.amount, 0);
        let percent = (spent / item.amount) * 100;
        if (percent > 100) percent = 100;
        
        let colorClass = "";
        if (percent >= 90) colorClass = "danger";
        else if (percent >= 70) colorClass = "warning";

        container.innerHTML += `
            <div class="item-card budget-card" onclick="openEditForm('budget', '${item.id}')">
                <div class="budget-header">
                    <div class="item-left">
                        <div class="item-icon"><i data-lucide="target"></i></div>
                        <div class="item-info"><h5>${item.category}</h5></div>
                    </div>
                    <div style="font-weight: 600;">Límite: ${formatMoney(item.amount)}</div>
                </div>
                <div class="budget-progress-container">
                    <div class="budget-progress-fill ${colorClass}" style="width: ${percent}%;"></div>
                </div>
                <div class="budget-stats">
                    <span>Gastado: ${formatMoney(spent)}</span>
                    <span>Restante: ${formatMoney(item.amount - spent)}</span>
                </div>
            </div>
        `;
    });
}

function renderWealth() {
    const container = document.getElementById("wealth-list");
    container.innerHTML = wealth.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">Crea tu primer bolsillo de ahorro o activo.</p>`;
    wealth.forEach(item => {
        container.innerHTML += `
            <div class="item-card" onclick="openEditForm('wealth', '${item.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${item.icon || 'briefcase'}"></i></div>
                    <div class="item-info">
                        <h5>${item.name}</h5>
                        <p>${item.description || 'Activo'}</p>
                    </div>
                </div>
                <div style="font-weight: 600;">${formatMoney(item.amount)}</div>
            </div>
        `;
    });
}

// --- FORMULARIOS (CREAR/EDITAR) ---
window.toggleForm = (type = null) => {
    activeFormType = type;
    editingId = null; 
    btnDeleteForm.style.display = 'none';

    if (!type) return modalForm.classList.remove('active');
    
    modalForm.classList.add('active');
    formTitle.textContent = "Añadir Nuevo";
    
    if (type === 'budget') {
        formFields.innerHTML = `${generarSelect(CATEGORIES.budget, 'Categoría a limitar')}<input type="number" id="f-amount" class="glass-input" placeholder="Monto máximo ($)">`;
    } else if (type === 'transaction') {
        formFields.innerHTML = `${generarSelect(Object.keys(CATEGORIES.transaction), 'Selecciona Categoría')}<input type="number" id="f-amount" class="glass-input" placeholder="Valor ($)"><input type="text" id="f-desc" class="glass-input" placeholder="Descripción (Ej. Uber)">`;
    } else if (type === 'wealth') {
        // Selector de Iconos visual para los bolsillos
        let iconOptions = CATEGORIES.wealthIcons.map(w => `<option value="${w.name}|${w.icon}">${w.name}</option>`).join('');
        formFields.innerHTML = `
            <select id="f-wealth-type" class="glass-input"><option value="" disabled selected>Tipo de Bolsillo / Activo</option>${iconOptions}</select>
            <input type="text" id="f-desc" class="glass-input" placeholder="Nombre personalizado (Ej. Banco de Bogotá)">
            <input type="number" id="f-amount" class="glass-input" placeholder="Saldo actual ($)">
        `;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id;
    formTitle.textContent = "Editar / Eliminar";
    btnDeleteForm.style.display = 'block';

    let item = (type === 'transaction' ? transactions : (type === 'budget' ? budgets : wealth)).find(i => i.id === id);
    
    if (type === 'wealth') {
        document.getElementById("f-wealth-type").value = `${item.name}|${item.icon}`;
        document.getElementById("f-amount").value = item.amount;
        document.getElementById("f-desc").value = item.description || "";
    } else {
        document.getElementById("f-cat").value = item.category;
        document.getElementById("f-amount").value = item.amount;
        if(document.getElementById("f-desc")) document.getElementById("f-desc").value = item.description || "";
    }
};

function generarSelect(options, placeholder) {
    return `<select id="f-cat" class="glass-input"><option value="" disabled selected>${placeholder}</option>${options.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`;
}

// --- ESCRITURA EN NUBE (CON ID DE USUARIO) ---
btnSubmitForm.addEventListener("click", async () => {
    if (!activeFormType || !currentUser) return;
    
    btnSubmitForm.textContent = "Guardando...";
    btnSubmitForm.disabled = true;

    let dataToSave = { 
        createdAt: Date.now(),
        userId: currentUser.uid // ¡El candado de seguridad! Amarramos el dato al usuario
    };

    if (activeFormType === 'wealth') {
        const typeData = document.getElementById("f-wealth-type").value;
        const amount = parseFloat(document.getElementById("f-amount").value);
        if (!typeData || !amount) { btnSubmitForm.disabled = false; btnSubmitForm.textContent = "Guardar"; return alert("Llena los datos."); }
        
        const [name, icon] = typeData.split('|');
        dataToSave.name = name;
        dataToSave.icon = icon;
        dataToSave.amount = amount;
        dataToSave.description = document.getElementById("f-desc").value;
    } else {
        const cat = document.getElementById("f-cat").value;
        const amount = parseFloat(document.getElementById("f-amount").value);
        if (!cat || !amount) { btnSubmitForm.disabled = false; btnSubmitForm.textContent = "Guardar"; return alert("Llena los datos."); }

        dataToSave.category = cat;
        dataToSave.amount = amount;
        
        if (activeFormType === 'transaction') {
            dataToSave.type = CATEGORIES.transaction[cat]; 
            dataToSave.description = document.getElementById("f-desc") ? document.getElementById("f-desc").value : "";
        }
    }

    const collectionName = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : 'wealth');

    try {
        if (editingId) await updateDoc(doc(db, collectionName, editingId), dataToSave);
        else await addDoc(collection(db, collectionName), dataToSave);
        window.toggleForm();
    } catch (e) { alert("Error: " + e.message); } 
    finally { btnSubmitForm.textContent = "Guardar"; btnSubmitForm.disabled = false; }
});

btnDeleteForm.addEventListener("click", async () => {
    if (!editingId) return;
    const collectionName = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : 'wealth');
    try {
        await deleteDoc(doc(db, collectionName, editingId));
        window.toggleForm();
    } catch (e) { alert("Error al eliminar"); }
});