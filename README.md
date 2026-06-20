# 🚍 APBusConnect

APBusConnect is a journey planning application built using APSRTC GTFS transit data that helps passengers discover both **direct** and **connecting bus routes** across Andhra Pradesh.

Unlike traditional route search systems that only display direct buses, APBusConnect identifies transfer points and recommends the most suitable connecting journeys when direct services are unavailable.

## 🌐 Live Demo

https://apbusconnect.xyz

## 📂 GitHub Repository

https://github.com/Sai630414/APBusConnect

## ✨ Features

* Search direct bus routes between two stops
* Find connecting bus routes when direct buses are unavailable
* Intelligent transfer point detection
* Journey recommendations with minimum transfers
* GTFS-based route planning
* Fast client-side search
* Works with APSRTC transit data

## 🚌 Example

### Search

Kadapa → Pamur

### Result

1. Kadapa → Badvel
2. Change Bus at Badvel
3. Badvel → Pamur

Transfers: 1

This allows passengers to discover journeys that would otherwise appear unavailable.

## 📊 Data Source

This project uses publicly available GTFS (General Transit Feed Specification) transit data.

GTFS files used:

* stops.txt
* trips.txt
* stop_times.txt

## 🛠️ Technologies Used

* HTML
* CSS
* JavaScript
* GTFS Transit Data
* Vercel
* Google Search Console

## 🔍 How It Works

1. Load GTFS transit files
2. Build stop-to-trip mappings
3. Search for direct routes
4. If no direct route exists:

   * Find all reachable stops from source
   * Find all reachable stops from destination
   * Detect common transfer points
   * Recommend the best connecting journey

## 🚀 Future Enhancements

* Multi-transfer journey planning
* Real-time APSRTC vehicle tracking integration
* Journey duration optimization
* Interactive route maps
* Ticket booking integration
* Mobile application
* Route popularity analytics

## 💡 Motivation

Many passengers struggle to discover bus journeys when direct services are unavailable.

For example, travel platforms may display "No Buses Available" even though a journey can be completed using connecting buses.

APBusConnect aims to bridge this gap by helping passengers discover practical transfer-based routes.

## 👨‍💻 Author

Sai Kondareddy

Integrated M.Tech, Computer Science and Engineering

VIT-AP University

Email: [saikondareddypala@gmail.com](mailto:saikondareddypala@gmail.com)

LinkedIn: https://www.linkedin.com/in/saikondareddy

## 📜 License

This project is licensed under the MIT License.
