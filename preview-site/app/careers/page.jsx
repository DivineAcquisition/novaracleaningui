import Link from "next/link";
import { Icon } from "../../components/Icons";
import { jobs } from "../../lib/content";

export const metadata = { title: "Careers | NovaraCleaning™" };

export default function CareersPage() {
  return (
    <main>
      <section className="hero page-hero">
        <div className="wrap">
          <h1>Join Our Team</h1>
          <p className="lede">Check out our open positions and see if you’re a great fit for the team.</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap">
          <div className="jobs">
            {jobs.map((job) => (
              <article className="job" key={job.title}>
                <div>
                  <h3>{job.title}</h3>
                  <p>{job.body}</p>
                  <div className="meta-row">
                    <span><Icon name="pin" size={16} /> {job.place}</span>
                    <span><Icon name="briefcase" size={16} /> {job.mode}</span>
                    <span><Icon name="money" size={16} /> {job.pay}</span>
                  </div>
                </div>
                {job.external ? (
                  <a className="btn btn-primary" href={job.href}>Apply Now <Icon name="arrow" size={16} /></a>
                ) : (
                  <Link className="btn btn-primary" href={job.href}>Apply Now <Icon name="arrow" size={16} /></Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
