from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
import requests
from io import BytesIO
from fpdf import FPDF
import os

app = Flask(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

def download_openai_file(file_id):
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    url = f"https://api.openai.com/v1/files/{file_id}/content"
    res = requests.get(url, headers=headers)
    print(f"[DEBUG] Richiesta download file {file_id}, status {res.status_code}")
    if res.status_code != 200:
        print("Errore recupero file OpenAI:", res.text)
        raise Exception(f"Errore nel recupero file OpenAI: {res.text}")
    return BytesIO(res.content)

def best_fit_model(x, y):
    from sklearn.linear_model import LinearRegression
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.metrics import r2_score

    models = {}

    # Lineare
    lin = LinearRegression().fit(x.reshape(-1,1), y)
    r2_lin = r2_score(y, lin.predict(x.reshape(-1,1)))
    models['lineare'] = (r2_lin, lin.coef_.tolist(), lin.intercept_)

    # Polinomiale (grado 2)
    poly = PolynomialFeatures(degree=2)
    x_poly = poly.fit_transform(x.reshape(-1,1))
    poly_reg = LinearRegression().fit(x_poly, y)
    r2_poly = r2_score(y, poly_reg.predict(x_poly))
    models['polinomiale'] = (r2_poly, poly_reg.coef_.tolist(), poly_reg.intercept_)

    # Logaritmico
    x_log = np.log(x[x > 0])
    y_log = y[x > 0]
    if len(x_log) > 1:
        log_reg = LinearRegression().fit(x_log.reshape(-1,1), y_log)
        r2_log = r2_score(y_log, log_reg.predict(x_log.reshape(-1,1)))
        models['logaritmico'] = (r2_log, log_reg.coef_.tolist(), log_reg.intercept_)
    
    best = max(models.items(), key=lambda i: i[1][0])
    return best[0], best[1][0], best[1][1], best[1][2]

def generate_pdf(model, coeffs, r2, intercept):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, txt="Risultati della Regressione", ln=True, align="C")
    pdf.ln(10)
    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"Modello: {model}\nCoefficiente/i: {coeffs}\nIntercetta: {intercept}\nR²: {r2:.4f}")
    output = "/tmp/output.pdf"
    pdf.output(output)
    return output

@app.route("/analizza_file_regressione", methods=["POST"])
def analizza_file_regressione():
    data = request.get_json()
    print("[DEBUG] Payload ricevuto:", data)
    file_id = data.get("file_id") if data else None

    if not file_id:
        print("[ERROR] Manca il parametro file_id!")
        return jsonify({"errore": "Manca il parametro file_id!"}), 400

    print("[Render] Ricevuto file_id:", file_id)

    # Scarica il file da OpenAI
    try:
        file_stream = download_openai_file(file_id)
        print("[DEBUG] File scaricato da OpenAI")
    except Exception as e:
        print("[ERROR] Download file:", e)
        return jsonify({"errore": "Impossibile scaricare file da OpenAI.", "dettaglio": str(e)}), 400

    # Prova a leggere CSV dal file
    try:
        df = pd.read_csv(file_stream)
        print("[DEBUG] CSV letto correttamente, shape:", df.shape)
    except Exception as e:
        print("[ERROR] Parsing CSV:", e)
        return jsonify({"errore": "Errore nel parsing CSV", "dettaglio": str(e)}), 400

    if df.shape[1] < 2:
        print("[ERROR] Il file ha meno di 2 colonne!")
        return jsonify({"errore": "Il file deve avere almeno 2 colonne."}), 400

    x = df.iloc[:, 0].values
    y = df.iloc[:, 1].values

    model, r2, coeffs, intercept = best_fit_model(x, y)
    path = generate_pdf(model, coeffs, r2, intercept)
    print("[DEBUG] PDF generato:", path)

    return jsonify({
        "model": model,
        "coeffs": coeffs,
        "intercept": intercept,
        "r2": r2,
        "pdf_path": path
    })

@app.route("/stima", methods=["POST"])
def stima():
    data = request.get_json()
    print("[DEBUG] Payload ricevuto (stima):", data)
    modello = data.get("modello")
    coeffs = data.get("coeffs")
    x = data.get("x")
    intercept = data.get("intercept", 0)

    y = 0
    if modello == "lineare":
        y = coeffs[0] * x + intercept
    elif modello == "polinomiale":
        y = sum(c * (x ** i) for i, c in enumerate(coeffs))
    elif modello == "logaritmico":
        y = coeffs[0] * np.log(x) + intercept
    else:
        print("[ERROR] Modello non riconosciuto:", modello)
        return jsonify({"errore": "Modello non riconosciuto"}), 400

    return jsonify({"x": x, "y": y})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
