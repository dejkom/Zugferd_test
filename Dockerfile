FROM python:3.11-slim

# Namestitev OpenJDK (JRE) za Mustang-CLI.jar in orodij
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Kopiranje requirements in namestitev python paketov
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopiranje kode aplikacije in potrebnih datotek
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY Mustang-CLI.jar .

# Ustvarjanje map za shrambo
RUN mkdir -p uploads outputs

# Izpostavimo privzeta vrata
EXPOSE 8000

# Zagon uvicorn strežnika na 0.0.0.0
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
