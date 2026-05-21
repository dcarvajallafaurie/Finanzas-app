import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from "./firebaseConfig.js";

// Elementos de UI
const authPanel = document.getElementById("auth-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const modalForm = document.getElementById("modal-form");
const formTitle = document.getElementById("form-title");
const formFields = document.getElementById("form-fields");
const btnSubmitForm = document.getElementById("btnSubmitForm");
const btnDeleteForm = document.getElementById("btnDeleteForm");

// Estado de datos
let budgets = JSON.parse(localStorage.getItem('budgets')) || [];
let transactions = JSON.parse(localStorage.getItem('transactions')) || [];
let wealth = JSON.parse(localStorage.getItem('wealth')) || [];
let activeFormType = null; 
let editingId = null; // Para saber si estamos creando o editando

// DICCIONARIO INTELIGENTE: Asigna automáticamente si es Ingreso o Gasto
const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense", "Otros Gastos": "expense"
    },
    wealth: ["Acciones", "Finca Raíz", "Criptomonedas", "Vehículos", "Ahorro Bancario", "Efectivo"]
};

// Formato de Moneda
function formatMoney(amount) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount); }

// Login Auth
onAuthStateChanged(auth, (user) => {
    if (user) {
        authPanel.style.display = "none";
        dashboardPanel.style.display = "flex";
        document.getElementById("user-display").textContent = user.email.split('@')[0];
        window.showView('home'); 
    } else {
        authPanel.style.display = "block";
        dashboardPanel.style.display = "none";
    }
});

document.getElementById("btnRegister").addEventListener("click", async () => {
    try { await createUserWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert(e.message); }
});
document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Datos incorrectos"); }
});
document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

// Navegación de Vistas
window.showView = (viewName) => {
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    const navItems = { 'home': 0, 'budgets': 1, 'wealth': 2 };
    document.querySelectorAll('.nav-item')[navItems[viewName]].classList.add('active');

    actualizarDatosUI();
};

function actualizarDatosUI() {
    // Calcular totales
    const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    
    document.getElementById("total-income").textContent = `+${formatMoney(income)}`;
    document.getElementById("total-expense").textContent = `-${formatMoney(expense)}`;
    document.getElementById("total-balance").textContent = formatMoney(income - expense);
    document.getElementById("total-wealth-value").textContent = formatMoney(wealth.reduce((sum, w) => sum + w.amount, 0));

    // Renderizar listas (reutilizando la función para los tres)
    renderList(transactions.slice().reverse(), document.getElementById("transaction-list"), 'transaction'); // Reverse para ver el último primero
    renderList(budgets, document.getElementById("budget-list"), 'budget');
    renderList(wealth, document.getElementById("wealth-list"), 'wealth');
    lucide.createIcons(); // Recargar iconos inyectados
}

// Lógica de Renderizado (Con soporte onClick para EDITAR)
function renderList(data, container, type) {
    container.innerHTML = data.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">No hay registros aún.</p>`;
    
    data.forEach(item => {
        let valClass = type === 'transaction' ? (item.type === 'income' ? 'val-income' : 'val-expense') : '';
        let prefix = type === 'transaction' ? (item.type === 'income' ? '+' : '-') : '';
        let iconName = type === 'wealth' ? 'landmark' : (type === 'budget' ? 'target' : (item.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'));

        container.innerHTML += `
            <div class="item-card" onclick="openEditForm('${type}', ${item.id})">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${iconName}"></i></div>
                    <div class="item-info">
                        <h5>${item.category || item.name}</h5>
                        <p>${item.description || 'Detalle'}</p>
                    </div>
                </div>
                <div class="${valClass}">${prefix}${formatMoney(item.amount)}</div>
            </div>
        `;
    });
}

// Abrir formulario (Crear o Editar)
window.toggleForm = (type = null) => {
    activeFormType = type;
    editingId = null; 
    btnDeleteForm.style.display = 'none';

    if (!type) return modalForm.classList.remove('active');
    
    modalForm.classList.add('active');
    formTitle.textContent = "Añadir Nuevo";
    
    if (type === 'budget') {
        formFields.innerHTML = `${generarSelect(CATEGORIES.budget)}<input type="number" id="f-amount" class="glass-input" placeholder="Monto asignado">`;
    } else if (type === 'transaction') {
        // En transacción, las opciones del select son las claves del diccionario
        formFields.innerHTML = `${generarSelect(Object.keys(CATEGORIES.transaction))}<input type="number" id="f-amount" class="glass-input" placeholder="Valor ($)"><input type="text" id="f-desc" class="glass-input" placeholder="Descripción (Ej. Uber)">`;
    } else if (type === 'wealth') {
        formFields.innerHTML = `${generarSelect(CATEGORIES.wealth)}<input type="text" id="f-desc" class="glass-input" placeholder="Nombre (Ej. Apartamento)"><input type="number" id="f-amount" class="glass-input" placeholder="Valor actual ($)">`;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id;
    formTitle.textContent = "Editar / Ver Detalle";
    btnDeleteForm.style.display = 'block';

    let item = (type === 'transaction' ? transactions : (type === 'budget' ? budgets : wealth)).find(i => i.id === id);
    
    document.getElementById("f-cat").value = item.category;
    document.getElementById("f-amount").value = item.amount;
    if(document.getElementById("f-desc")) document.getElementById("f-desc").value = item.description || item.name || "";
};

function generarSelect(options) {
    return `<select id="f-cat" class="glass-input"><option value="" disabled selected>Selecciona Categoría</option>${options.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`;
}

// Guardar (Crear o Actualizar)
btnSubmitForm.addEventListener("click", () => {
    if (!activeFormType) return;
    
    const cat = document.getElementById("f-cat").value;
    const amount = parseFloat(document.getElementById("f-amount").value);
    const desc = document.getElementById("f-desc") ? document.getElementById("f-desc").value : "";
    if (!cat || !amount) return alert("Llena los datos.");

    let newItem = { id: editingId || Date.now(), category: cat, amount: amount };

    // MAGIA: El tipo se detecta solo mirando el diccionario (solo para transacciones)
    if (activeFormType === 'transaction') {
        newItem.type = CATEGORIES.transaction[cat]; 
        newItem.description = desc;
        guardarDato(transactions, 'transactions', newItem);
    } else if (activeFormType === 'budget') {
        guardarDato(budgets, 'budgets', newItem);
    } else {
        newItem.name = desc;
        guardarDato(wealth, 'wealth', newItem);
    }
    
    window.toggleForm();
    actualizarDatosUI();
});

// Eliminar
btnDeleteForm.addEventListener("click", () => {
    if (activeFormType === 'transaction') transactions = transactions.filter(i => i.id !== editingId);
    if (activeFormType === 'budget') budgets = budgets.filter(i => i.id !== editingId);
    if (activeFormType === 'wealth') wealth = wealth.filter(i => i.id !== editingId);
    
    localStorage.setItem(`${activeFormType}s`, JSON.stringify(activeFormType === 'transaction' ? transactions : (activeFormType === 'budget' ? budgets : wealth)));
    window.toggleForm();
    actualizarDatosUI();
});

function guardarDato(array, storageKey, item) {
    if (editingId) {
        let index = array.findIndex(i => i.id === editingId);
        array[index] = item;
    } else {
        array.push(item);
    }
    localStorage.setItem(storageKey, JSON.stringify(array));
}