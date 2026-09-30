# 1. faza: Java Runtime okolje
FROM eclipse-temurin:17-jre AS java-runtime

# 2. faza: Glavna Python aplikacija
FROM python:3.11-slim

# Kopiramo JRE neposredno iz uradne JRE slike (brez apt-get repozitorijev!)
ENV JAVA_HOME=/opt/java/openjdk
COPY --from=java-runtime $JAVA_HOME $JAVA_HOME
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

# Kopiranje requirements in namestitev python paketov
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopiranje kode aplikacije in datotek
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY Mustang-CLI.jar .

# Ustvarjanje map za shrambo
RUN mkdir -p uploads outputs

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
